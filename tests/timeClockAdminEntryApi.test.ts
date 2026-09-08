import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import handler from '../pages/api/admin/time-clock';
import { createSessionToken, SESSION_COOKIE } from '../lib/session';
import { lastCompletedFortnight } from '../lib/timeClockEntry';
import { addCalendarDays } from '../lib/timeClockCore';
import { createClockEvent, EVENT_HEADERS, requestFingerprint } from '../lib/timeClock';

test('admin manual entry flows through the API and Sheets ledger with optional notes, validation, retry protection and audit', async (t) => {
  const previous = { ...process.env };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.SESSION_SECRET = 'isolated-time-clock-entry-test';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'fixture@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'fixture-only-spreadsheet';
  process.env.TIME_CLOCK_SPREADSHEET_ID = 'fixture-only-spreadsheet';
  process.env.TUTOR_CONFIG_JSON = JSON.stringify([{ campusKey: 'test-campus', tutorName: 'Demo Tutor', role: 'tutor', active: true }]);
  const sheets = new Map<string, unknown[][]>([['unrelated', [['keep'], ['untouched']]]]);
  const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  // Intercept every outbound call. No real Google credentials or spreadsheet are used.
  t.mock.method(globalThis, 'fetch', async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') return reply({ access_token: 'fixture-token', expires_in: 3600 });
    assert.equal(url.hostname, 'sheets.googleapis.com');
    assert.ok(url.pathname.includes('fixture-only-spreadsheet'));
    const path = decodeURIComponent(url.pathname);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith(':batchUpdate')) {
      for (const request of body.requests) sheets.set(request.addSheet.properties.title, []);
      return reply({});
    }
    if (!path.includes('/values/')) return reply({ sheets: [...sheets.keys()].map((title) => ({ properties: { title } })) });
    const range = path.split('/values/')[1];
    const name = range.split('!')[0].replace(/^'|'$/g, '');
    if (method === 'GET') return reply({ values: sheets.get(name) || [] });
    if (path.endsWith(':append')) {
      sheets.set(name, [...(sheets.get(name) || []), ...body.values]);
    } else if (method === 'PUT') {
      assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
      sheets.set(name, body.values);
    } else {
      assert.fail(`Unexpected test Sheets request: ${method} ${path}`);
    }
    return reply({});
  });
  try {
    const admin = await createSessionToken({ tutor: 'Demo Admin', campus: 'test-campus', role: 'admin' });
    const tutor = await createSessionToken({ tutor: 'Demo Tutor', campus: 'test-campus', role: 'tutor' });
    async function request(method: string, body: any = {}, token = admin, query: any = {}) {
      let status = 200;
      let data: any;
      const res = { setHeader() {}, status(value: number) { status = value; return res; }, json(value: any) { data = value; return res; } };
      await handler({ method, query, body, headers: { cookie: `${SESSION_COOKIE}=${token}`, 'content-type': 'application/json' } } as any, res as any);
      return { status, data };
    }
    const range = lastCompletedFortnight();
    const initial = await request('GET');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.data.range, { ...range, calendarDays: 14 });
    const shiftDate = '2026-08-31';
    const create = { action: 'create_shift', requestId: 'manual_api_create_123456', tutorName: 'Demo Tutor', clockIn: `${shiftDate}T16:00`, clockOut: `${shiftDate}T20:00` };
    assert.equal((await request('POST', create, tutor)).status, 403);
    const missingEnd = await request('POST', { ...create, clockOut: '' });
    assert.equal(missingEnd.status, 422);
    assert.equal(missingEnd.data.code, 'CLOCK_OUT_REQUIRED');
    for (const end of [`${shiftDate}T16:00`, `${shiftDate}T15:00`]) {
      assert.equal((await request('POST', { ...create, clockOut: end })).data.code, 'INVALID_CLOCK_ORDER');
    }
    assert.equal((await request('POST', { ...create, clockOut: `${addCalendarDays(shiftDate, 1)}T01:00` })).data.code, 'SAME_DAY_REQUIRED');
    assert.equal((await request('POST', { ...create, tutorName: 'Other campus tutor' })).status, 404);
    const saved = await request('POST', create);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.shift.manual, true);
    assert.equal(saved.data.shift.clockInBy, 'Demo Admin');
    assert.equal(saved.data.shift.clockInAdminOverride, false);
    assert.deepEqual(saved.data.shift.reviewFlags, []);
    assert.equal(sheets.get('time_clock_events')?.length, 2);
    assert.equal(sheets.get('time_clock_adjustments')?.length, 2);
    const retry = await request('POST', create);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.shift.shiftId, saved.data.shift.shiftId);
    assert.equal(sheets.get('time_clock_events')?.length, 2);
    const duplicate = await request('POST', { ...create, requestId: 'manual_api_duplicate_1234' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.code, 'OVERLAPPING_SHIFT');
    const edit = { action: 'edit_shift', requestId: 'manual_api_edit_1234567', shiftId: saved.data.shift.shiftId, version: saved.data.shift.version, clockIn: `${shiftDate}T17:00`, clockOut: `${shiftDate}T20:00` };
    assert.equal((await request('POST', edit)).data.code, 'REASON_REQUIRED');
    // Regression: a short written reason previously left Save silently disabled.
    const edited = await request('POST', { ...edit, reason: 'Typo' });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.shift.normalMinutes, 120);
    assert.equal(edited.data.shift.after7Minutes, 60);
    const payroll = await request('GET', {}, admin, { from: shiftDate, to: shiftDate });
    assert.equal(payroll.data.summary[0].normalHours, 2);
    assert.equal(payroll.data.summary[0].after7Hours, 1);
    assert.equal(payroll.data.summary[0].reviewCount, 0);
    assert.equal(payroll.data.adjustments.length, 2);
    assert.ok(payroll.data.adjustments.some((entry: any) => entry.action === 'created' && entry.reason === '' && entry.changedBy === 'Demo Admin'));
    assert.ok(payroll.data.adjustments.some((entry: any) => entry.action === 'edited' && entry.oldClockIn === saved.data.shift.clockIn && entry.newClockIn === edited.data.shift.clockIn));
    assert.ok(payroll.data.adjustments.some((entry: any) => entry.action === 'edited' && entry.reason === 'Typo'));

    // Existing manually-created open shifts must still be closable, even though
    // the new manual-entry form requires an end time at creation.
    const oldDate = addCalendarDays(shiftDate, 1);
    const legacy = createClockEvent({
      action: 'admin_create', campusKey: 'test-campus', tutorId: saved.data.shift.tutorId,
      tutorName: 'Demo Tutor', actorName: 'Demo Admin', actorRole: 'admin',
      occurredAt: `${oldDate}T10:00:00.000Z`, clockIn: `${oldDate}T06:02:00.000Z`, clockOut: '',
      targetShiftId: 'legacy-open-manual-shift', requestId: 'legacy_open_manual_request',
      requestFingerprint: requestFingerprint({ legacy: true }), reason: 'Missed start time',
      adminOverride: 'TRUE', overrideReason: 'Missed start time',
    } as any);
    sheets.get('time_clock_events')!.push(EVENT_HEADERS.map((key) => legacy[key] || ''));
    const corrected = await request('POST', {
      action: 'edit_shift', requestId: 'close_legacy_manual_request', shiftId: legacy.targetShiftId,
      version: 1, clockIn: `${oldDate}T16:02`, clockOut: `${oldDate}T19:51`, reason: 'Fixed',
    });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
    assert.equal(corrected.data.shift.status, 'completed');
    assert.equal(corrected.data.shift.normalMinutes, 178);
    assert.equal(corrected.data.shift.after7Minutes, 51);
    assert.deepEqual(corrected.data.shift.reviewFlags, []);
    const closedView = await request('GET', {}, admin, { from: oldDate, to: oldDate });
    assert.equal(closedView.data.summary[0].reviewCount, 0);
    assert.ok(closedView.data.adjustments.some((entry: any) => entry.action === 'edited' && entry.oldClockOut === '' && entry.newClockOut === corrected.data.shift.clockOut && entry.reason === 'Fixed'));
    assert.deepEqual(sheets.get('unrelated'), [['keep'], ['untouched']]);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
