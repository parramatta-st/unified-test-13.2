import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayrollRange,
  createClockEvent,
  replayTimeClockEvents,
  requestFingerprint,
  type ClockEvent,
} from '../lib/timeClock';

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
