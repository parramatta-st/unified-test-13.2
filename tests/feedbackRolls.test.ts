import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureSheets } from './helpers/timeClockSheets';
import { createSessionToken } from '../lib/session';
import adminHandler from '../pages/api/admin/feedback-rolls';
import feedbackHandler from '../pages/api/feedback-schedule';
import { collectionTicket, importRolls, readRollEvents, rollState, validateRollCapture } from '../lib/feedbackRolls';

const date = '2026-10-20';
const member = { id: 'member-1', firstName: 'Example', lastName: 'Student', parentName: 'Parent', parentEmail: 'parent@example.invalid', years: 'Year 4', gender: '', active: true };
function capture(id = 'capture-one', tutor = 'Demo Tutor', studentName = 'Example Student') {
  return { schemaVersion: 2, date, captureId: id, mode: 'replace_day', sessions: [{ hapanaSessionId: date + ':100:1', sessionTitle: 'English', tutorNameRaw: tutor, startMinute: 960, endMinute: 1020, students: [{ id: 'hapana-1', name: studentName, phone: 'PRIVATE_PHONE', payment: 'PRIVATE_PAYMENT' }] }] };
}
function response() { return { code: 200, body: null as any, setHeader() {}, status(code: number) { this.code = code; return this; }, json(body: any) { this.body = body; return this; }, end() { return this; } }; }
async function request(handler: any, tutor: string, role: 'admin' | 'tutor', body?: any, query: any = { date }, extraHeaders = {}, campus = 'parramatta') {
  const token = await createSessionToken({ tutor, campus, role });
  const res = response();
  await handler({ method: body ? 'POST' : 'GET', query, body, headers: { cookie: 'st_sess=' + token, host: 'portal.example.invalid', origin: 'https://portal.example.invalid', ...extraHeaders } } as any, res as any);
  return res;
}
function setup(t: any) {
  const fixture = fixtureSheets(t);
  process.env.TUTOR_CONFIG_JSON = JSON.stringify(['Demo Admin', 'Demo Tutor', 'Second Tutor', 'Sai'].map(tutorName => ({ campusKey: 'parramatta', tutorName, active: true })));
  fixture.sheets.set('contacts', [Object.keys(member), Object.values(member)]);
  return fixture;
}

test('Daily Rolls payload whitelists names/IDs and rejects invalid or incomplete capture shapes', () => {
  const result = validateRollCapture(capture());
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  for (const bad of [ { ...capture(), date: '2026-02-31' }, { ...capture(), sessions: [] }, { ...capture(), schemaVersion: 1 }, { ...capture(), sessions: [capture().sessions[0], capture().sessions[0]] } ]) assert.throws(() => validateRollCapture(bad));
  const noId = capture(); noId.sessions[0].students[0].id = ''; assert.throws(() => validateRollCapture(noId));
});

test('sync authenticates and scopes every action before accessing Sheets; blocks cross-site and preview writes', async t => {
  const fixture = setup(t);
  try {
    const missing = response(); await adminHandler({ method: 'POST', body: {}, headers: {} } as any, missing as any); assert.equal(missing.code, 401);
    assert.equal((await request(adminHandler, 'Demo Tutor', 'tutor', { action: 'begin_feedback_collection', date, captureId: 'one' })).code, 403);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'begin_feedback_collection', date, captureId: 'one' }, {}, {}, 'other')).code, 403);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'begin_feedback_collection', date, captureId: 'one' }, {}, { origin: 'https://attacker.invalid' })).code, 403);
    process.env.VERCEL_ENV = 'preview';
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'begin_feedback_collection', date, captureId: 'one' })).code, 403);
    assert.equal(fixture.sheets.has('feedback_roll_events'), false);
  } finally { fixture.restore(); }
});

test('signed collection flows from admin import through private Sheets to tutor Feedback without changing payroll', async t => {
  const fixture = setup(t);
  try {
    const start = await request(adminHandler, 'Demo Admin', 'admin', { action: 'begin_feedback_collection', date, captureId: 'capture-one' }); assert.equal(start.code, 200);
    const saved = await request(adminHandler, 'Demo Admin', 'admin', { action: 'import_feedback_schedule', capture: capture(), ticket: start.body.ticket }); assert.equal(saved.code, 200); assert.equal(saved.body.bookings, 1);
    const rowsBefore = fixture.sheets.get('feedback_roll_events')!.length;
    const replay = await request(adminHandler, 'Demo Admin', 'admin', { action: 'import_feedback_schedule', capture: capture(), ticket: start.body.ticket }); assert.equal(replay.body.replayed, true); assert.equal(fixture.sheets.get('feedback_roll_events')!.length, rowsBefore);
    const feed = await request(feedbackHandler, 'Demo Tutor', 'tutor', undefined, { date, tutor: 'Second Tutor', campus: 'other' }); assert.equal(feed.body.source, 'daily_rolls'); assert.equal(feed.body.sessions[0].students[0].id, member.id); assert.equal(feed.body.sessions[0].students[0].email, member.parentEmail);
    assert.equal((await request(feedbackHandler, 'Second Tutor', 'tutor')).body.sessions.length, 0);
    assert.equal(feed.body.sessions[0].students[0].isMakeup, false, 'Ordinary daily imports are not makeup bookings');
    const overview = await request(adminHandler, 'Demo Admin', 'admin'); assert.equal(overview.body.instructors[0].target, 'Demo Tutor');
    assert.ok(!JSON.stringify([...fixture.sheets]).includes('PRIVATE_'));
    assert.equal(fixture.sheets.has('time_clock_events'), false); assert.equal(fixture.sheets.has('hapana_schedule_events'), false);
  } finally { fixture.restore(); }
});

test('Sai/full-name aliases match by unique first name; explicit overrides and student links remain available', async t => {
  const fixture = setup(t);
  try {
    const raw = capture('sai-collection', 'Sai Arulanathan (sub)', 'Different Display Name');
    await importRolls(raw, collectionTicket('parramatta', 'Demo Admin', date, raw.captureId), 'parramatta', 'Demo Admin');
    assert.equal((await request(feedbackHandler, 'Sai', 'tutor')).body.sessions.length, 1);
    const overview = await request(adminHandler, 'Demo Admin', 'admin'); assert.equal(overview.body.instructors[0].target, 'Sai'); assert.equal(overview.body.instructors[0].reason, 'tutor_first_name'); assert.equal(overview.body.students[0].target, '');
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'link_identity', date, kind: 'tutor', source: 'Sai Arulanathan', target: 'Sai' })).code, 200);
    let feed = await request(feedbackHandler, 'Sai', 'tutor'); assert.equal(feed.body.sessions[0].students[0].memberMatched, false);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'link_identity', date, kind: 'student', sessionId: date + ':100:1', source: 'hapana-1', target: member.id })).code, 200);
    feed = await request(feedbackHandler, 'Sai', 'tutor'); assert.equal(feed.body.sessions[0].students[0].name, 'Example Student'); assert.equal(feed.body.sessions[0].students[0].email, member.parentEmail);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'link_identity', date, kind: 'student', sessionId: date + ':100:1', source: 'not-collected', target: member.id })).code, 400);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'link_identity', date, kind: 'tutor', source: 'Sai Arulanathan', target: 'Unknown' })).code, 400);
  } finally { fixture.restore(); }
});

test('a full Hapana parent name resolves via the portal parent-first-name field to the canonical student and recipient', async t => {
  const fixture = setup(t);
  try {
    const child = { ...member, id: 's10', firstName: 'Vishnuchith', lastName: 'Balakrishnan', parentName: 'Balakrishnan' };
    fixture.sheets.set('contacts', [Object.keys(child), Object.values(child)]);
    const raw = capture('parent-first-name', 'Sai Arulanathan', 'Balakrishnan Ramalingam');
    await importRolls(raw, collectionTicket('parramatta', 'Demo Admin', date, raw.captureId), 'parramatta', 'Demo Admin');
    const overview = await request(adminHandler, 'Demo Admin', 'admin');
    assert.equal(overview.body.students[0].target, 's10'); assert.equal(overview.body.students[0].reason, 'parent_first_name');
    const feed = await request(feedbackHandler, 'Sai', 'tutor');
    assert.equal(feed.body.sessions[0].students[0].name, 'Vishnuchith Balakrishnan');
    assert.equal(feed.body.sessions[0].students[0].email, member.parentEmail);
    assert.equal(fixture.sheets.get('feedback_roll_events')!.length, 3, 'Automatic linking needs no manual link event');
  } finally { fixture.restore(); }
});

test('parent-owned Hapana records link different children per dated class without guessing a parent name', async t => {
  const fixture = setup(t);
  try {
    const sibling = { ...member, id: 'member-2', firstName: 'Sibling' };
    fixture.sheets.set('contacts', [Object.keys(member), Object.values(member), Object.values(sibling)]);
    const raw = capture('parent-bookings', 'Demo Tutor', 'Parent');
    raw.sessions.push({ ...raw.sessions[0], hapanaSessionId: date + ':101:1', startMinute: 1020, endMinute: 1080 });
    await importRolls(raw, collectionTicket('parramatta', 'Demo Admin', date, raw.captureId), 'parramatta', 'Demo Admin');
    let overview = await request(adminHandler, 'Demo Admin', 'admin');
    assert.equal(overview.body.students.length, 2);
    assert.ok(overview.body.students.every((student: any) => student.target === ''));
    const link = (sessionId: string, target: string) => request(adminHandler, 'Demo Admin', 'admin', { action: 'link_identity', date, kind: 'student', source: 'hapana-1', sessionId, target, scope: 'class' });
    assert.equal((await link(date + ':999:1', member.id)).code, 400);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { action: 'link_identity', date, kind: 'student', source: 'hapana-1', target: member.id })).code, 400);
    assert.equal((await link(date + ':100:1', member.id)).code, 200);
    overview = await request(adminHandler, 'Demo Admin', 'admin');
    assert.equal(overview.body.students.find((student: any) => student.sessionId === date + ':100:1').target, member.id);
    assert.equal(overview.body.students[0].target, '', 'Unresolved bookings are sorted first');
    assert.equal((await link(date + ':101:1', sibling.id)).code, 200);
    const feed = await request(feedbackHandler, 'Demo Tutor', 'tutor');
    assert.deepEqual(feed.body.sessions.map((session: any) => session.students[0].id), [member.id, sibling.id]);
    assert.deepEqual(feed.body.sessions.map((session: any) => session.students[0].name), ['Example Student', 'Sibling Student']);
    assert.ok(feed.body.sessions.every((session: any) => session.students[0].email === member.parentEmail));
    // The same class on a later day must not inherit a parent-to-child assumption.
    const nextDate = '2026-10-21', next = { ...capture('parent-next-day', 'Demo Tutor', 'Parent'), date: nextDate };
    next.sessions[0].hapanaSessionId = nextDate + ':100:1';
    await importRolls(next, collectionTicket('parramatta', 'Demo Admin', nextDate, next.captureId), 'parramatta', 'Demo Admin');
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', undefined, { date: nextDate })).body.students[0].target, '');
    assert.equal((await link(date + ':100:1', '')).code, 200);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin')).body.students[0].target, '');
  } finally { fixture.restore(); }
});

test('manual links are remembered across classes and dates, replace the current class exception, and reject invalid scopes', async t => {
  const fixture = setup(t);
  try {
    const sibling = { ...member, id: 'member-2', firstName: 'Sibling' };
    fixture.sheets.set('contacts', [Object.keys(member), Object.values(member), Object.values(sibling)]);
    const raw = capture('remember-me', 'Demo Tutor', 'Unrecognised Booking');
    raw.sessions.push({ ...raw.sessions[0], hapanaSessionId: date + ':101:1', startMinute: 1020, endMinute: 1080 });
    await importRolls(raw, collectionTicket('parramatta', 'Demo Admin', date, raw.captureId), 'parramatta', 'Demo Admin');
    const body = { action: 'link_identity', date, kind: 'student', source: 'hapana-1', sessionId: date + ':100:1', target: sibling.id };
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { ...body, scope: 'class' })).code, 200);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { ...body, scope: 'bogus' })).code, 400);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { ...body, target: 'not-active' })).code, 400);
    assert.equal((await request(adminHandler, 'Demo Admin', 'admin', { ...body, target: member.id })).code, 200);
    const overview = await request(adminHandler, 'Demo Admin', 'admin');
    assert.ok(overview.body.students.every((student: any) => student.target === member.id && student.reason === 'remembered'));
    const nextDate = '2026-10-21', next = { ...capture('remember-next-day', 'Demo Tutor', 'Sibling Student'), date: nextDate };
    next.sessions[0].hapanaSessionId = nextDate + ':100:1';
    await importRolls(next, collectionTicket('parramatta', 'Demo Admin', nextDate, next.captureId), 'parramatta', 'Demo Admin');
    const feed = await request(feedbackHandler, 'Demo Tutor', 'tutor', undefined, { date: nextDate });
    assert.equal(feed.body.sessions[0].students[0].id, member.id);
    assert.equal(feed.body.sessions[0].students[0].email, member.parentEmail);
    assert.equal(fixture.sheets.has('time_clock_events'), false);
  } finally { fixture.restore(); }
});

test('newer collections win, substitutions remove the old tutor, and partial collections retain unseen classes', async t => {
  const fixture = setup(t);
  try {
    const old = capture('old'), newer = capture('new', 'Second Tutor');
    const oldTicket = collectionTicket('parramatta', 'Demo Admin', date, old.captureId, Date.now() - 5000);
    await importRolls(newer, collectionTicket('parramatta', 'Demo Admin', date, newer.captureId), 'parramatta', 'Demo Admin');
    await assert.rejects(importRolls(old, oldTicket, 'parramatta', 'Demo Admin'), /newer collection/);
    assert.equal((await request(feedbackHandler, 'Demo Tutor', 'tutor')).body.sessions.length, 0);
    assert.equal((await request(feedbackHandler, 'Second Tutor', 'tutor')).body.sessions.length, 1);
    const visible = capture('visible'); visible.mode = 'observed_sessions'; visible.sessions[0].hapanaSessionId = date + ':101:1';
    await importRolls(visible, collectionTicket('parramatta', 'Demo Admin', date, visible.captureId), 'parramatta', 'Demo Admin');
    assert.equal(rollState(await readRollEvents(), 'parramatta', date).sessions.length, 2);
    const replacement = capture('replacement');
    await importRolls(replacement, collectionTicket('parramatta', 'Demo Admin', date, replacement.captureId), 'parramatta', 'Demo Admin');
    assert.equal(rollState(await readRollEvents(), 'parramatta', date).sessions.length, 1);
  } finally { fixture.restore(); }
});

test('invalid, expired and changed-admin tickets never create imports; partial or tampered ledger data cannot replace a good day', async t => {
  const fixture = setup(t);
  try {
    const raw = capture();
    await assert.rejects(importRolls(raw, 'invalid', 'parramatta', 'Demo Admin'));
    await assert.rejects(importRolls(raw, collectionTicket('parramatta', 'Demo Admin', date, raw.captureId, Date.now() - 3 * 3600000), 'parramatta', 'Demo Admin'));
    await assert.rejects(importRolls(raw, collectionTicket('parramatta', 'Demo Admin', date, raw.captureId), 'parramatta', 'Other Admin'));
    await importRolls(raw, collectionTicket('parramatta', 'Demo Admin', date, raw.captureId), 'parramatta', 'Demo Admin');
    const original = fixture.sheets.get('feedback_roll_events')!;
    const withoutCommit = original.slice(0, -1); fixture.sheets.set('feedback_roll_events', withoutCommit);
    assert.equal(rollState(await readRollEvents(), 'parramatta', date).latest, null);
    const tampered = original.map(row => [...row]); tampered[1][8] = '{}'; fixture.sheets.set('feedback_roll_events', tampered);
    assert.equal(rollState(await readRollEvents(), 'parramatta', date).latest, null);
    fixture.sheets.set('feedback_roll_events', original);
    assert.equal(rollState(await readRollEvents(), 'parramatta', date).sessions.length, 1);
    fixture.failReads(true);
    const before = original.length;
    const changed = capture('next'); await assert.rejects(importRolls(changed, collectionTicket('parramatta', 'Demo Admin', date, changed.captureId), 'parramatta', 'Demo Admin'));
    assert.equal(fixture.sheets.get('feedback_roll_events')!.length, before);
  } finally { fixture.restore(); }
});
