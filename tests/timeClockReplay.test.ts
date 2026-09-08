import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayrollRange,
  createClockEvent,
  replayTimeClockEvents,
  requestFingerprint,
  type ClockEvent,
} from '../lib/timeClock';
import { lastCompletedFortnight } from '../lib/timeClockEntry';
import { rangeFromSydneyDateKeys } from '../lib/timeClockCore';
import { reviewExplanation } from '../lib/timeClockReview';

const campusKey = 'test-campus';
const tutorId = 'test-tutor-id';
const tutorName = 'Test Tutor';

function event(
  action: string,
  overrides: Partial<ClockEvent> = {},
): ClockEvent {
  const requestId = overrides.requestId || `request_${action}_${Math.random().toString(36).slice(2)}`;
  const fingerprint =
    overrides.requestFingerprint || requestFingerprint({ action, requestId });
  return createClockEvent({
    requestId,
    requestFingerprint: fingerprint,
    campusKey,
    tutorId,
    tutorName,
    action,
    occurredAt: '2026-08-31T07:00:00.000Z',
    actorName: tutorName,
    actorRole: 'tutor',
    targetShiftId: 'shift_1',
    latitude: '0',
    longitude: '0',
    accuracy: '20',
    distanceM: '10',
    locationVerified: 'TRUE',
    ...overrides,
  } as any);
}

test('deduplicates a retried request without creating a second shift', () => {
  const fingerprint = requestFingerprint({ action: 'clock_in', target: tutorName });
  const first = event('clock_in', {
    eventId: 'event_first',
    requestId: 'request_same_123456',
    requestFingerprint: fingerprint,
  });
  const retry = event('clock_in', {
    eventId: 'event_retry',
    requestId: 'request_same_123456',
    requestFingerprint: fingerprint,
    targetShiftId: 'shift_should_not_exist',
  });
  const replay = replayTimeClockEvents([first, retry], {
    nowMs: Date.parse('2026-08-31T08:00:00.000Z'),
  });
  assert.equal(replay.shifts.length, 1);
  assert.equal(replay.shifts[0].shiftId, 'shift_1');
  assert.equal(replay.outcomes.get('event_retry')?.accepted, true);
  assert.equal(replay.outcomes.get('event_retry')?.replayed, true);
});

test('deterministically rejects the second simultaneous clock-in', () => {
  const first = event('clock_in', {
    eventId: 'event_in_1',
    requestId: 'request_clock_in_1111',
  });
  const second = event('clock_in', {
    eventId: 'event_in_2',
    requestId: 'request_clock_in_2222',
    targetShiftId: 'shift_2',
    occurredAt: '2026-08-31T07:00:00.100Z',
  });
  const replay = replayTimeClockEvents([first, second]);
  assert.equal(replay.shifts.length, 1);
  assert.equal(replay.outcomes.get('event_in_1')?.accepted, true);
  assert.equal(replay.outcomes.get('event_in_2')?.accepted, false);
  assert.equal(replay.outcomes.get('event_in_2')?.code, 'ALREADY_CLOCKED_IN');
});

test('clocks out with server event time and calculates exclusive pay bands', () => {
  const clockIn = event('clock_in', {
    eventId: 'event_in',
    requestId: 'request_clock_in_3333',
    occurredAt: '2026-08-31T07:00:00.000Z', // 5 PM Sydney
  });
  const clockOut = event('clock_out', {
    eventId: 'event_out',
    requestId: 'request_clock_out_333',
    occurredAt: '2026-08-31T11:00:00.000Z', // 9 PM Sydney
    baseVersion: '1',
  });
  const replay = replayTimeClockEvents([clockIn, clockOut]);
  assert.equal(replay.outcomes.get('event_out')?.accepted, true);
  assert.equal(replay.shifts[0].status, 'completed');
  assert.equal(replay.shifts[0].normalHours, 2);
  assert.equal(replay.shifts[0].after7Hours, 2);
  assert.equal(replay.shifts[0].saturdayHours, 0);
  assert.equal(replay.shifts[0].normalMinutes, 120);
  assert.equal(replay.shifts[0].after7Minutes, 120);

  const payroll = buildPayrollRange({
    state: {
      ...replay,
      sourceFingerprint: '',
      rawEventCount: replay.events.length,
    },
    campusKey,
    startMs: Date.parse('2026-08-30T14:00:00.000Z'),
    endMs: Date.parse('2026-09-01T14:00:00.000Z'),
  });
  assert.equal(payroll.summary[0].normalMinutes, 120);
  assert.equal(payroll.summary[0].after7Minutes, 120);
  assert.equal(payroll.summary[0].normalHours, 2);
  assert.equal(payroll.summary[0].after7Hours, 2);
});

test('applies one versioned admin edit, audits it, and rejects a stale edit', () => {
  const clockIn = event('clock_in', {
    eventId: 'event_in',
    requestId: 'request_clock_in_4444',
  });
  const clockOut = event('clock_out', {
    eventId: 'event_out',
    requestId: 'request_clock_out_444',
    occurredAt: '2026-08-31T11:00:00.000Z',
    baseVersion: '1',
  });
  const edit = event('admin_edit', {
    eventId: 'event_edit',
    requestId: 'request_admin_edit_444',
    actorName: 'Test Admin',
    actorRole: 'admin',
    occurredAt: '2026-09-01T00:00:00.000Z',
    baseVersion: '2',
    clockIn: '2026-08-31T08:30:00.000Z', // 6:30 PM Sydney
    clockOut: '2026-08-31T09:30:00.000Z', // 7:30 PM Sydney
    reason: 'Confirmed corrected times with the tutor.',
  });
  const staleEdit = event('admin_edit', {
    eventId: 'event_stale',
    requestId: 'request_admin_edit_555',
    actorName: 'Test Admin',
    actorRole: 'admin',
    occurredAt: '2026-09-01T00:00:01.000Z',
    baseVersion: '2',
    clockIn: '2026-08-31T08:00:00.000Z',
    clockOut: '2026-08-31T09:00:00.000Z',
    reason: 'A concurrent outdated correction attempt.',
  });
  const replay = replayTimeClockEvents([clockIn, clockOut, edit, staleEdit]);
  assert.equal(replay.shifts[0].version, 3);
  assert.equal(replay.shifts[0].normalHours, 0.5);
  assert.equal(replay.shifts[0].after7Hours, 0.5);
  assert.equal(replay.adjustments.length, 1);
  assert.equal(replay.adjustments[0].changedBy, 'Test Admin');
  assert.equal(replay.outcomes.get('event_stale')?.code, 'STALE_SHIFT');
});

test('voids a shift without deleting its history or payroll audit', () => {
  const clockIn = event('clock_in', {
    eventId: 'event_in',
    requestId: 'request_clock_in_6666',
  });
  const clockOut = event('clock_out', {
    eventId: 'event_out',
    requestId: 'request_clock_out_666',
    occurredAt: '2026-08-31T09:00:00.000Z',
    baseVersion: '1',
  });
  const voidEvent = event('admin_void', {
    eventId: 'event_void',
    requestId: 'request_admin_void_666',
    actorName: 'Test Admin',
    actorRole: 'admin',
    occurredAt: '2026-09-01T00:00:00.000Z',
    baseVersion: '2',
    reason: 'Duplicate shift entered in error.',
  });
  const replay = replayTimeClockEvents([clockIn, clockOut, voidEvent]);
  assert.equal(replay.shifts.length, 1);
  assert.equal(replay.shifts[0].status, 'voided');
  assert.equal(replay.adjustments[0].action, 'voided');
  assert.equal(replay.adjustments[0].oldStatus, 'completed');
});

test('ignores a ledger event whose cells were edited after creation', () => {
  const valid = event('clock_in', {
    eventId: 'event_tampered',
    requestId: 'request_tampered_777',
  });
  const tampered = { ...valid, occurredAt: '2026-08-31T06:00:00.000Z' };
  const replay = replayTimeClockEvents([tampered]);
  assert.equal(replay.shifts.length, 0);
  assert.equal(replay.integrityWarnings.length, 1);
  assert.equal(replay.outcomes.get('event_tampered')?.code, 'EVENT_INTEGRITY_FAILED');
});

test('manual creation needs no reason but still records admin, timestamps, notes, payroll, and adjustment history', () => {
  const manual = event('admin_create', {
    eventId: 'manual_no_reason', actorRole: 'admin', actorName: 'Test Admin',
    occurredAt: '2026-09-08T01:00:00.000Z',
    clockIn: '2026-09-07T06:00:00.000Z', clockOut: '2026-09-07T10:00:00.000Z',
    notes: '', reason: '', adminOverride: 'FALSE', locationVerified: 'FALSE',
  });
  const replay = replayTimeClockEvents([manual]);
  assert.equal(replay.outcomes.get(manual.eventId)?.accepted, true);
  const shift = replay.shifts[0];
  assert.equal(shift.clockInBy, 'Test Admin');
  assert.equal(shift.createdAt, manual.occurredAt);
  assert.equal(shift.clockIn, manual.clockIn);
  assert.equal(shift.manual, true);
  assert.equal(shift.clockInAdminOverride, false);
  assert.deepEqual(shift.reviewFlags, []);
  assert.equal(shift.normalMinutes, 180);
  assert.equal(shift.after7Minutes, 60);
  assert.equal(replay.adjustments[0].changedBy, 'Test Admin');
  assert.equal(replay.adjustments[0].reason, '');
  assert.equal(replay.adjustments[0].newClockOut, manual.clockOut);
  const duplicate = event('admin_create', { ...manual, eventId: 'duplicate_manual', requestId: 'different_manual_request', targetShiftId: 'duplicate_shift' });
  const overlapped = replayTimeClockEvents([manual, duplicate]);
  assert.equal(overlapped.outcomes.get(duplicate.eventId)?.code, 'OVERLAPPING_SHIFT');
  assert.equal(overlapped.shifts.length, 1);
  const unauthorised = event('admin_create', { ...manual, eventId: 'unauthorised_manual', actorRole: 'tutor' });
  assert.equal(replayTimeClockEvents([unauthorised]).outcomes.get(unauthorised.eventId)?.code, 'ADMIN_REQUIRED');
  const edit = event('admin_edit', { ...manual, action: 'admin_edit', eventId: 'edit_without_reason', requestId: 'edit_without_reason_request', baseVersion: '1' });
  assert.equal(replayTimeClockEvents([manual, edit]).outcomes.get(edit.eventId)?.code, 'REASON_REQUIRED');
});

test('recorded location overrides remain audited without falsely flagging valid hours', () => {
  const clockIn = event('clock_in', { actorRole: 'admin', actorName: 'Test Admin', locationVerified: 'FALSE', adminOverride: 'TRUE', overrideReason: 'Test 1' });
  const clockOut = event('clock_out', { actorRole: 'admin', actorName: 'Test Admin', occurredAt: '2026-08-31T09:00:00.000Z', baseVersion: '1', locationVerified: 'FALSE', adminOverride: 'TRUE', overrideReason: 'Test 1' });
  const replay = replayTimeClockEvents([clockIn, clockOut]);
  assert.deepEqual(replay.shifts[0].reviewFlags, []);
  assert.equal(replay.shifts[0].clockInOverrideReason, 'Test 1');
  assert.equal(replay.shifts[0].clockOutOverrideReason, 'Test 1');
});

test('missing clock-outs appear in payroll review with an explanation but add no unpaid open hours', () => {
  const clockIn = event('clock_in', { occurredAt: '2026-09-07T06:00:00.000Z' });
  const nowMs = Date.parse('2026-09-08T10:00:00+10:00');
  const replay = replayTimeClockEvents([clockIn], { nowMs, openShiftAlertHours: 12 });
  assert.ok(replay.shifts[0].reviewFlags.includes('open_over_limit'));
  assert.ok(replay.shifts[0].reviewFlags.includes('crosses_midnight'));
  assert.match(reviewExplanation('open_over_limit'), /enter the end time/);
  const dates = lastCompletedFortnight(nowMs);
  const range = rangeFromSydneyDateKeys(dates.from, dates.to);
  assert.ok(range.ok);
  const view = buildPayrollRange({ state: { ...replay, sourceFingerprint: '', rawEventCount: 1 }, campusKey, startMs: range.startMs, endMs: range.endMs, nowMs });
  assert.equal(view.summary[0].reviewCount, 1);
  assert.equal(view.summary[0].shifts, 0);
  assert.equal(view.summary[0].totalMinutes, 0);
});
