import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import handler from '../pages/api/door-clock';
import adminHandler from '../pages/api/admin-door-clock';
import { fixtureSheets } from './helpers/timeClockSheets';
import { assertDoorWritesAllowed, DOOR_HEADERS, changeDoorLink, doorTokenHash, doorTutors, loadDoorLinks, validDoorToken } from '../lib/doorClock';
import { createClockEvent, EVENT_HEADERS, replayTimeClockEvents, timeClockSheetNames, tutorIdFor } from '../lib/timeClock';
import { rowsToObjects } from '../lib/googleSheets';
import { createSessionToken } from '../lib/session';
import { DOOR_CHOICE_KEY, pendingKey, readDoorChoice, readDoorPending } from '../lib/doorClockClient';
import { doorQrSvg } from '../lib/doorQr';

const campus = 'test-campus';
const tutorId = tutorIdFor(campus, 'Demo Tutor');
const headers = (key = '') => ({ host: 'door.example.invalid', origin: 'https://door.example.invalid', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-st-door-key': key });
async function call(api: typeof handler, method: string, key = '', body: any = {}, query: any = {}, extra: Record<string, string> = {}) {
  let status = 200; let data: any; const responseHeaders: Record<string, unknown> = {};
  const res: any = { setHeader(k: string, v: unknown) { responseHeaders[k] = v; }, status(n: number) { status = n; return res; }, json(j: unknown) { data = j; return res; }, end() { return res; } };
  await api({ method, body, query, headers: { ...headers(key), ...extra }, socket: { remoteAddress: '127.0.0.1' } } as any, res);
  return { status, data, headers: responseHeaders };
}
const clockIn = () => ({ action: 'clock_in', tutorId, expectedShiftId: '', expectedVersion: 0, requestId: `door_${crypto.randomUUID()}` });
function events(fixture: ReturnType<typeof fixtureSheets>) { return rowsToObjects(fixture.sheets.get(timeClockSheetNames().events) as any || []); }

test('door keys are unguessable-sized and hashes are deterministic, never the raw key', () => {
  const key = crypto.randomBytes(32).toString('base64url');
  assert.equal(key.length, 43); assert.ok(validDoorToken(key));
  for (const invalid of ['', key + 'x', key.slice(1), ['x'], null, ' '.repeat(43)]) assert.equal(validDoorToken(invalid), false);
  assert.equal(doorTokenHash(key).length, 64); assert.equal(doorTokenHash(key), doorTokenHash(key)); assert.notEqual(doorTokenHash(key), key);
});

test('unkeyed requests and foreign POST origins never contact upstream services', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network call'); });
  assert.equal((await call(handler, 'GET')).status, 401);
  assert.equal((await call(handler, 'POST', 'a'.repeat(43), clockIn(), {}, { origin: 'https://other.example.invalid' })).status, 403);
  assert.equal((await call(handler, 'POST', 'a'.repeat(43), clockIn(), {}, { origin: '' })).status, 403);
  assert.equal((await call(handler, 'POST', 'a'.repeat(43), clockIn(), {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call(handler, 'POST', 'a'.repeat(43), clockIn(), {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await call(handler, 'DELETE')).status, 405);
  assert.equal((globalThis.fetch as any).mock.callCount(), 0);
});

test('GET lists only active centre tutors without emails, roles, cookies or payroll', async t => {
  const fixture = fixtureSheets(t);
  try {
    process.env.TUTOR_CONFIG_JSON = JSON.stringify([
      { campusKey: campus, tutorName: 'Demo Tutor', role: 'admin', active: true, email: 'staff@example.invalid' },
      { campusKey: campus, tutorName: 'Inactive', active: false },
      { campusKey: 'other-centre', tutorName: 'Other centre', active: true },
    ]);
    const { token } = await changeDoorLink(campus, 'Demo Admin', 'create');
    const result = await call(handler, 'GET', token);
    assert.equal(result.status, 200); assert.equal(result.data.tutors.length, 1);
    assert.deepEqual(Object.keys(result.data.tutors[0]).sort(), ['id', 'name']);
    assert.equal(result.headers['Set-Cookie'], undefined);
    assert.match(String(result.headers['Cache-Control']), /no-store/);
    assert.equal(result.headers['Referrer-Policy'], 'no-referrer');
    assert.equal(result.data.activeShifts, undefined); assert.equal(result.data.payroll, undefined);
    assert.equal(result.data.selectedId, ''); assert.equal(result.data.activeShift, null);
  } finally { fixture.restore(); }
});

test('door clock-in and out use server timestamps, audited name selection, no fake GPS, and original ledger', async t => {
  const fixture = fixtureSheets(t);
  try {
    const { token } = await changeDoorLink(campus, 'Demo Admin', 'create');
    const operation = clockIn(); const startedAt = Date.now();
    const input = await call(handler, 'POST', token, { ...operation, actorName: 'Forged Admin', actorRole: 'admin', adminOverride: true, latitude: 0, locationVerified: true, occurredAt: '2001-01-01T00:00:00Z' });
    assert.equal(input.status, 200); assert.equal(input.data.tutorName, 'Demo Tutor');
    assert.ok(Date.parse(input.data.timestamp) >= startedAt);
    const firstEvents = events(fixture); assert.equal(firstEvents.length, 1);
    assert.equal(firstEvents[0].schemaVersion, '2'); assert.equal(firstEvents[0].actorRole, 'tutor');
    assert.equal(firstEvents[0].actorName, 'Demo Tutor'); assert.equal(firstEvents[0].accessMethod, 'door_link');
    assert.equal(firstEvents[0].identityMethod, 'name_selection'); assert.equal(firstEvents[0].locationVerified, 'FALSE');
    assert.equal(firstEvents[0].adminOverride, 'FALSE'); assert.equal(firstEvents[0].latitude, '');
    const status = await call(handler, 'GET', token, {}, { tutorId });
    assert.equal(status.data.activeShift.version, 1);
    assert.equal(status.data.activeShift.needsReview, false);
    await new Promise(resolve => setTimeout(resolve, 10));
    const out = await call(handler, 'POST', token, { action: 'clock_out', tutorId, expectedShiftId: status.data.activeShift.shiftId, expectedVersion: 1, requestId: `door_${crypto.randomUUID()}` });
    assert.equal(out.status, 200); assert.equal(out.data.action, 'clock_out');
    const replay = replayTimeClockEvents(events(fixture));
    assert.equal(replay.shifts.length, 1); assert.equal(replay.shifts[0].status, 'completed');
    assert.equal(replay.shifts[0].clockInAccessMethod, 'door_link'); assert.equal(replay.shifts[0].clockOutAccessMethod, 'door_link');
    assert.ok(!replay.shifts[0].reviewFlags.includes('clock_in_location_unverified'));
    assert.ok(!replay.shifts[0].reviewFlags.includes('clock_out_location_unverified'));
    assert.deepEqual(fixture.sheets.get('unrelated'), [['keep'], ['untouched']]);
  } finally { fixture.restore(); }
});

test('duplicate and concurrent identical requests return original result rather than opening a second shift', async t => {
  const fixture = fixtureSheets(t);
  try {
    const { token } = await changeDoorLink(campus, 'Demo Admin', 'create'); const operation = clockIn();
    const results = await Promise.all([call(handler, 'POST', token, operation), call(handler, 'POST', token, operation)]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal(events(fixture).length, 1); assert.ok(results.some(r => r.data.replayed));
    const bad = await call(handler, 'POST', token, { ...operation, tutorId: tutorIdFor(campus, 'Second Tutor') });
    // Different tutors have independent request namespaces, and cannot alter the first tutor's shift.
    assert.equal(bad.status, 200); assert.equal(events(fixture).length, 2);
    assert.equal(replayTimeClockEvents(events(fixture)).shifts.filter(s => s.tutorId === tutorId).length, 1);
  } finally { fixture.restore(); }
});

test('stale pages cannot clock out a different shift or convert a clock-in into a clock-out', async t => {
  const fixture = fixtureSheets(t);
  try {
    const { token } = await changeDoorLink(campus, 'Demo Admin', 'create');
    assert.equal((await call(handler, 'POST', token, clockIn())).status, 200);
    assert.equal((await call(handler, 'POST', token, clockIn())).status, 409);
    const result = await call(handler, 'POST', token, { ...clockIn(), action: 'clock_out', expectedShiftId: 'some-other-shift', expectedVersion: 1 });
    assert.equal(result.status, 409); assert.equal(events(fixture).length, 1);
    assert.equal(replayTimeClockEvents(events(fixture)).shifts[0].status, 'active');
  } finally { fixture.restore(); }
});

test('unknown/inactive tutor IDs, admin actions, malformed states and request IDs are rejected', async t => {
  const fixture = fixtureSheets(t);
  try {
    const { token } = await changeDoorLink(campus, 'Demo Admin', 'create');
    for (const body of [{ ...clockIn(), tutorId: 'not-a-tutor' }, { ...clockIn(), action: 'admin_void' }, { ...clockIn(), expectedVersion: -1 }, { ...clockIn(), requestId: 'short' }, { ...clockIn(), expectedShiftId: null }]) {
      const result = await call(handler, 'POST', token, body); assert.ok(result.status >= 400 && result.status < 500);
    }
    assert.equal(events(fixture).length, 0);
  } finally { fixture.restore(); }
});

test('replacing or disabling a tag immediately revokes its previous key; tokens stay hashed', async t => {
  const fixture = fixtureSheets(t);
  try {
    const first = await changeDoorLink(campus, 'Demo Admin', 'create');
    const second = await changeDoorLink(campus, 'Demo Admin', 'rotate');
    assert.notEqual(first.token, second.token);
    assert.equal((await call(handler, 'GET', first.token)).status, 401);
    assert.equal((await call(handler, 'GET', second.token)).status, 200);
    assert.ok(!JSON.stringify([...fixture.sheets.values()]).includes(second.token));
    await changeDoorLink(campus, 'Demo Admin', 'disable');
    assert.equal((await call(handler, 'GET', second.token)).status, 401);
    assert.equal((await loadDoorLinks()).length, 1);
  } finally { fixture.restore(); }
});

test('a malformed newest settings row never revives a previous active link', async t => {
  const fixture = fixtureSheets(t);
  try {
    const first = await changeDoorLink(campus, 'Demo Admin', 'create');
    const rows = fixture.sheets.get('door_clock_links')!;
    rows.push(DOOR_HEADERS.map(h => ({ campusKey: campus, enabled: 'TRUE', tokenHash: 'corrupt' } as any)[h] || ''));
    assert.equal((await call(handler, 'GET', first.token)).status, 401);
  } finally { fixture.restore(); }
});

test('upstream outages fail closed without disclosing service configuration or writing a shift', async t => {
  const fixture = fixtureSheets(t);
  try {
    const { token } = await changeDoorLink(campus, 'Demo Admin', 'create'); fixture.failReads(true);
    const result = await call(handler, 'POST', token, clockIn());
    assert.equal(result.status, 503); assert.equal(result.data.code, 'TEMPORARILY_UNAVAILABLE');
    assert.ok(!JSON.stringify(result).includes('fixture@example')); assert.equal(events(fixture).length, 0);
  } finally { fixture.restore(); }
});

test('door token cannot administer links or grant normal portal API access', async t => {
  const fixture = fixtureSheets(t);
  try {
    const { token } = await changeDoorLink(campus, 'Demo Admin', 'create');
    assert.equal((await call(adminHandler, 'POST', token, { action: 'rotate' })).status, 401);
    for (const path of ['contacts', 'curriculum', 'admin-members', 'admin-tutors', 'inbox-reply', 'send-feedback', 'time-clock', 'admin/time-clock']) {
      const api = (await import(`../pages/api/${path}`)).default;
      assert.ok([401, 403, 405].includes((await call(api, 'GET', token)).status), path);
    }
  } finally { fixture.restore(); }
});

test('only a signed admin may create a door link, scoped to their own campus', async t => {
  const fixture = fixtureSheets(t);
  try {
    const tutorCookie = `st_sess=${await createSessionToken({ tutor: 'Demo Tutor', campus, role: 'tutor' })}`;
    assert.equal((await call(adminHandler, 'POST', '', { action: 'create' }, {}, { cookie: tutorCookie })).status, 403);
    const cookie = `st_sess=${await createSessionToken({ tutor: 'Demo Admin', campus, role: 'admin' })}`;
    const result = await call(adminHandler, 'POST', '', { action: 'create', campus: 'other-centre' }, {}, { cookie });
    assert.equal(result.status, 200); assert.match(result.data.path, /^\/clock\/tap#key=[A-Za-z0-9_-]{43}$/);
    assert.equal((await loadDoorLinks())[0].campusKey, campus);
    const status = await call(adminHandler, 'GET', '', {}, {}, { cookie });
    assert.equal(status.data.tokenHash, undefined); assert.equal(status.data.path, undefined);
  } finally { fixture.restore(); }
});

test('legacy v1 event hashes remain valid while v2 method edits are detected', () => {
  const base = createClockEvent({ requestId: 'legacy_test_request_1234', requestFingerprint: 'fingerprint', campusKey: campus, tutorId, tutorName: 'Demo Tutor', action: 'clock_in', occurredAt: '2026-09-22T05:00:00Z', actorName: 'Demo Tutor', actorRole: 'tutor', targetShiftId: 'legacy_shift', locationVerified: 'TRUE' });
  const oldHeaders = EVENT_HEADERS.filter(h => !['accessMethod', 'accessPoint', 'identityMethod', 'eventHash'].includes(h));
  const originalHash = crypto.createHash('sha256').update(JSON.stringify(oldHeaders.map(h => String(base[h] ?? '').trim()))).digest('hex');
  assert.equal(base.eventHash, originalHash);
  const legacy = { ...base }; delete (legacy as any).accessMethod; delete (legacy as any).accessPoint; delete (legacy as any).identityMethod;
  assert.equal(replayTimeClockEvents([legacy]).shifts.length, 1);
  assert.equal(replayTimeClockEvents([{ ...legacy, accessMethod: 'door_link' }]).shifts.length, 0);
  const door = createClockEvent({ ...base, locationVerified: 'FALSE', accessMethod: 'door_link', accessPoint: 'test-door', identityMethod: 'name_selection' });
  assert.equal(replayTimeClockEvents([door]).shifts[0].clockInAccessMethod, 'door_link');
  assert.equal(replayTimeClockEvents([{ ...door, accessPoint: 'tampered' }]).integrityWarnings.length, 1);
});

test('door clocks still flag long/overnight shifts; missing ordinary portal GPS is not silently exempted', () => {
  const base = { requestId: 'review_test_request_1234', requestFingerprint: 'fingerprint', campusKey: campus, tutorId, tutorName: 'Demo Tutor', action: 'clock_in', occurredAt: '2026-09-21T05:00:00Z', actorName: 'Demo Tutor', actorRole: 'tutor', targetShiftId: 'review_shift' };
  const ordinary = createClockEvent(base);
  const door = createClockEvent({ ...base, accessMethod: 'door_link', accessPoint: 'test-door', identityMethod: 'name_selection' });
  const options = { nowMs: Date.parse('2026-09-22T05:00:00Z') };
  assert.ok(replayTimeClockEvents([ordinary], options).shifts[0].reviewFlags.includes('clock_in_location_unverified'));
  const flags = replayTimeClockEvents([door], options).shifts[0].reviewFlags;
  assert.ok(flags.includes('open_over_limit')); assert.ok(flags.includes('crosses_midnight')); assert.ok(!flags.includes('clock_in_location_unverified'));
});

test('remembered choices and uncertain requests survive reload but corrupted storage never crashes', () => {
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) || null };
  assert.equal(readDoorChoice(storage), null); values.set(DOOR_CHOICE_KEY, JSON.stringify({ campus, tutorId }));
  assert.deepEqual(readDoorChoice(storage), { campus, tutorId });
  values.set(DOOR_CHOICE_KEY, 'broken'); assert.equal(readDoorChoice(storage), null);
  assert.equal(readDoorChoice({ getItem() { throw new Error('denied'); } }), null);
  const key = pendingKey(campus, 'link'); const pending = { ...clockIn(), createdAt: Date.now() };
  values.set(key, JSON.stringify(pending)); assert.deepEqual(readDoorPending(storage, key), pending);
  assert.notEqual(pendingKey(campus, 'rotated'), key); values.set(key, '{}'); assert.equal(readDoorPending(storage, key), null);
});

test('QR generation is local, deterministic and has an intact four-module quiet zone', () => {
  const url = `https://door.example.invalid/clock/tap#key=${'a'.repeat(43)}`;
  const svg = doorQrSvg(url); assert.equal(svg, doorQrSvg(url));
  assert.match(svg, /shape-rendering="crispEdges"/); assert.match(svg, /fill="white"/); assert.ok(!svg.includes(url));
  assert.throws(() => doorQrSvg('javascript:alert(1)')); assert.throws(() => doorQrSvg('https://example.invalid/"injection'));
});


test('Vercel preview writes are blocked before any upstream request unless isolated staging is explicit', async t => {
  const before = { ...process.env };
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected upstream'); });
  try {
    process.env.VERCEL_ENV = 'preview'; delete process.env.DOOR_CLOCK_ALLOW_PREVIEW_WRITES;
    assert.throws(assertDoorWritesAllowed, /disabled in this preview/);
    assert.equal((await call(handler, 'POST', 'a'.repeat(43), clockIn())).status, 503);
    await assert.rejects(changeDoorLink(campus, 'Demo Admin', 'create'), /disabled in this preview/);
    process.env.DOOR_CLOCK_ALLOW_PREVIEW_WRITES = 'true';
    process.env.TIME_CLOCK_SPREADSHEET_ID = 'primary'; process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'primary';
    assert.throws(assertDoorWritesAllowed, /disabled in this preview/);
    process.env.TIME_CLOCK_SPREADSHEET_ID = 'separate-synthetic-staging';
    assert.doesNotThrow(assertDoorWritesAllowed);
    assert.equal((globalThis.fetch as any).mock.callCount(), 0);
  } finally { for (const key of ['VERCEL_ENV', 'DOOR_CLOCK_ALLOW_PREVIEW_WRITES', 'TIME_CLOCK_SPREADSHEET_ID', 'GOOGLE_SHEETS_SPREADSHEET_ID']) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
});
