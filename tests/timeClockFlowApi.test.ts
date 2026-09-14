import assert from 'node:assert/strict';
import test from 'node:test';
import clockHandler from '../pages/api/time-clock';
import adminHandler from '../pages/api/admin/time-clock';
import { createSessionToken, SESSION_COOKIE } from '../lib/session';
import { fixtureSheets } from './helpers/timeClockSheets';

test('clock APIs persist server times, status, combined payroll and actor audit with duplicate and permission safeguards', async (t) => {
  const fixture = fixtureSheets(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-08-31T07:00:00Z') });
  try {
    const tutor = await createSessionToken({ tutor: 'Demo Tutor', campus: 'test-campus', role: 'tutor' });
    const admin = await createSessionToken({ tutor: 'Demo Admin', campus: 'test-campus', role: 'admin' });
    const removed = await createSessionToken({ tutor: 'Removed Tutor', campus: 'test-campus', role: 'tutor' });
    async function request(handler: typeof clockHandler, method: string, body: any = {}, token = tutor, query: any = {}) {
      let status = 200; let data: any;
      const res = {setHeader() {}, status(value: number) {status = value; return res;}, json(value: any) {data = value; return res;}};
      await handler({method, body, query, headers: {cookie: `${SESSION_COOKIE}=${token}`, 'content-type': 'application/json'}} as any, res as any);
      return {status, data};
    }
    const location = {latitude: 0, longitude: 0, accuracy: 20};
    const entry = {action: 'clock_in', requestId: 'clock_in_flow_123456', location,
      clockIn: '2099-01-01T00:00Z', timestamp: '2099-01-01T00:00Z'};
    assert.equal((await request(clockHandler, 'POST', {...entry, tutorName: 'Second Tutor'})).status, 403);
    assert.equal((await request(clockHandler, 'POST', {...entry, adminOverride: true, overrideReason: 'GPS'})).status, 403);
    assert.equal((await request(clockHandler, 'POST', {...entry, location: null})).data.code, 'LOCATION_REQUIRED');
    assert.equal((await request(clockHandler, 'POST', {...entry, location: {...location, latitude: .01}})).data.code, 'OUTSIDE_GEOFENCE');
    assert.equal((await request(clockHandler, 'POST', {...entry, location: {...location, accuracy: 351}})).data.code, 'LOCATION_INACCURATE');
    for (const accuracy of [null, '', false, '20']) {
      assert.equal((await request(clockHandler, 'POST', {...entry, location: {...location, accuracy}})).data.code, 'INVALID_LOCATION');
    }
    assert.equal((await request(clockHandler, 'GET', {}, removed)).status, 403);
    const started = await request(clockHandler, 'POST', entry);
    assert.equal(started.status, 200, JSON.stringify(started.data));
    assert.equal(started.data.shift.clockIn, '2026-08-31T07:00:00.000Z');
    const retry = await request(clockHandler, 'POST', entry);
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.shift.shiftId, started.data.shift.shiftId);
    const double = await Promise.all(['a', 'b'].map(suffix => request(clockHandler, 'POST', {...entry, requestId: `double_clock_in_1234_${suffix}`})));
    assert.ok(double.every(r => r.status === 409 && r.data.code === 'ALREADY_CLOCKED_IN'));
    const status = await request(clockHandler, 'GET');
    assert.equal(status.data.activeShift.shiftId, started.data.shift.shiftId);
    assert.deepEqual(status.data.activeShifts, []);
    assert.deepEqual(status.data.tutors, []);
    t.mock.timers.tick(4 * 60 * 60 * 1000);
    const ended = await request(clockHandler, 'POST', {action: 'clock_out', requestId: 'clock_out_flow_123456', location});
    assert.equal(ended.status, 200);
    assert.equal(ended.data.shift.clockOut, '2026-08-31T11:00:00.000Z');
    assert.equal((await request(clockHandler, 'GET')).data.activeShift, null);
    assert.equal((await request(clockHandler, 'POST', {action: 'clock_out', requestId: 'extra_out_flow_123456', location})).data.code, 'NO_ACTIVE_SHIFT');
    const payroll = await request(adminHandler, 'GET', {}, admin, {from: '2026-08-31', to: '2026-08-31'});
    assert.equal(payroll.data.summary[0].normalHours, 2);
    assert.equal(payroll.data.summary[0].premiumHours, 2);
    assert.equal(payroll.data.rows[0].clockInLocationVerified, true);
    assert.equal(payroll.data.rows[0].clockOutLocationVerified, true);
    assert.equal((await request(adminHandler, 'GET')).status, 403);

    const override = {action: 'clock_in', requestId: 'admin_override_in_123456', tutorName: 'Second Tutor', adminOverride: true, overrideReason: 'GPS unavailable'};
    assert.equal((await request(clockHandler, 'POST', {...override, overrideReason: ''}, admin)).data.code, 'OVERRIDE_REASON_REQUIRED');
    const otherStarted = await request(clockHandler, 'POST', override, admin);
    assert.equal(otherStarted.status, 200);
    assert.equal(otherStarted.data.shift.tutorName, 'Second Tutor');
    assert.equal(otherStarted.data.shift.clockInBy, 'Demo Admin');
    t.mock.timers.tick(60_000);
    assert.equal((await request(clockHandler, 'POST', {...override, action: 'clock_out', requestId: 'admin_override_out_123456'}, admin)).status, 200);
    const otherRows = await request(adminHandler, 'GET', {}, admin, {from: '2026-08-31', to: '2026-08-31'});
    const second = otherRows.data.rows.find((row: any) => row.tutorName === 'Second Tutor');
    assert.equal(second.clockInBy, 'Demo Admin');
    assert.equal(second.clockOutBy, 'Demo Admin');
    assert.equal(second.clockInAdminOverride, true);
    assert.equal(second.clockInLocationVerified, false);
    assert.equal(second.clockInOverrideReason, 'GPS unavailable');
    assert.equal(second.clockOutOverrideReason, 'GPS unavailable');
    assert.deepEqual(fixture.sheets.get('unrelated'), [['keep'], ['untouched']]);

    fixture.failReads(true);
    const unavailable = await request(clockHandler, 'GET');
    assert.equal(unavailable.status, 500);
    assert.equal(unavailable.data.ok, false, 'A Sheets outage must never be reported as no active shift');
  } finally { fixture.restore(); }
});
