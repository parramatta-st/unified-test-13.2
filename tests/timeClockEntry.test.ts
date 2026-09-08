import assert from 'node:assert/strict';
import test from 'node:test';
import { checkShiftEntry, lastCompletedFortnight, localShiftInput, validateAdminShiftTimes } from '../lib/timeClockEntry';
import { rangeFromSydneyDateKeys, splitPaidHours } from '../lib/timeClockCore';

const now = Date.parse('2026-09-08T18:00:00+10:00');

test('last 14 days includes all previous 14 Sydney dates and excludes today', () => {
  assert.deepEqual(lastCompletedFortnight(now), { from: '2026-08-25', to: '2026-09-07' });
  // A Monday pay run includes the Monday two weeks earlier, through Sunday.
  assert.deepEqual(lastCompletedFortnight(Date.parse('2026-09-07T10:00:00+10:00')), { from: '2026-08-24', to: '2026-09-06' });
  // Sydney date differs from UTC; crossing year and DST boundaries is calendar-based.
  assert.deepEqual(lastCompletedFortnight(Date.parse('2027-01-01T00:30:00+11:00')), { from: '2026-12-18', to: '2026-12-31' });
  const dst = lastCompletedFortnight(Date.parse('2026-10-05T00:15:00+11:00'));
  assert.deepEqual(dst, { from: '2026-09-21', to: '2026-10-04' });
  const range = rangeFromSydneyDateKeys(dst.from, dst.to);
  assert.equal(range.ok && range.calendarDays, 14);
});

test('same-day manual entry rejects zero, negative, incomplete, and future times', () => {
  for (const end of ['2026-09-07T16:00', '2026-09-07T15:00']) {
    const result = checkShiftEntry('2026-09-07T16:00', end, true, now);
    assert.equal(result.ok, false);
    if (result.ok === false) assert.equal(result.code, 'INVALID_CLOCK_ORDER');
  }
  const missing = checkShiftEntry('2026-09-07T16:00', '', true, now);
  assert.equal(missing.ok === false && missing.code, 'CLOCK_OUT_REQUIRED');
  assert.equal(checkShiftEntry('2026-09-07T16:00', '', false, now).ok, true);
  assert.equal(checkShiftEntry('2026-02-30T16:00', '2026-02-30T20:00', true, now).ok, false);
  const future = checkShiftEntry('2026-09-09T16:00', '2026-09-09T20:00', true, now);
  assert.equal(future.ok === false && future.code, 'FUTURE_SHIFT');
});

test('server validation rejects a client-supplied next-day clock-out', () => {
  const issue = validateAdminShiftTimes(Date.parse('2026-09-04T23:00:00+10:00'), Date.parse('2026-09-05T02:00:00+10:00'), true, now);
  assert.equal(issue?.code, 'SAME_DAY_REQUIRED');
});

test('manual form preview uses the same exclusive payroll categories as the server', () => {
  for (const [start, end, expected] of [
    ['2026-09-07T17:00', '2026-09-07T21:00', [120, 120, 0]],
    ['2026-09-05T17:00', '2026-09-05T21:00', [0, 0, 240]],
  ] as const) {
    const result = checkShiftEntry(start, end, true, now);
    assert.ok(result.ok && result.endMs !== null);
    const hours = splitPaidHours(result.startMs, result.endMs);
    assert.deepEqual([hours.normalMinutes, hours.after7Minutes, hours.saturdayMinutes], expected);
  }
});

test('same-day form handles Sydney DST and preserves explicit instants when unchanged', () => {
  const later = Date.parse('2026-11-01T12:00:00+11:00');
  const skipped = checkShiftEntry('2026-10-04T02:30', '2026-10-04T03:30', true, later);
  assert.equal(skipped.ok === false && skipped.code, 'NONEXISTENT_LOCAL_TIME');
  const repeated = checkShiftEntry('2026-04-05T02:30', '2026-04-05T03:30', true, later);
  assert.equal(repeated.ok === false && repeated.code, 'AMBIGUOUS_LOCAL_TIME');
  assert.equal(localShiftInput('2026-04-05T02:30:17+11:00'), '2026-04-05T02:30');
  const explicit = checkShiftEntry('2026-04-05T02:30:17+11:00', '2026-04-05T03:30:17+10:00', true, later);
  assert.ok(explicit.ok && explicit.endMs !== null);
  assert.equal((explicit.endMs - explicit.startMs) / 3_600_000, 2);
});
