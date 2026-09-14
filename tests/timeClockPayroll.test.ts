import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayrollRange, createClockEvent, replayTimeClockEvents } from '../lib/timeClock';
import { parseSydneyDateTime, rangeFromSydneyDateKeys, splitPaidHours } from '../lib/timeClockCore';
import { combinedPremiumHours, payrollCsv } from '../lib/timeClockPayroll';

function ms(local: string) {
  const result = parseSydneyDateTime(local);
  if (result.ok === false) throw new Error(result.error);
  return result.ms;
}

test('combined premium hours cover weekdays after seven and all Saturday once, including midnight and DST', () => {
  for (const [start, end, normal, premium] of [
    ['2026-08-31T17:00', '2026-08-31T21:00', 2, 2],
    ['2026-08-31T18:30', '2026-08-31T19:30', .5, .5],
    ['2026-09-05T09:00', '2026-09-05T15:30', 0, 6.5],
    ['2026-09-05T17:00', '2026-09-05T21:00', 0, 4],
    ['2026-09-04T23:00', '2026-09-05T02:00', 0, 3],
    ['2026-10-03T23:00', '2026-10-04T04:00', 0, 1],
  ] as const) {
    const paid = splitPaidHours(ms(start), ms(end));
    assert.equal(paid.normalHours, normal);
    assert.equal(combinedPremiumHours(paid), premium);
    assert.equal(paid.normalMinutes + paid.after7Minutes + paid.saturdayMinutes + paid.unclassifiedMinutes, paid.elapsedMinutes);
  }
});

test('payroll combines integer minutes before rounding, clips ranges, excludes voids and retains audit buckets', () => {
  const events = [
    ['friday', '2026-09-04T23:59', '2026-09-05T00:01', 'parramatta'],
    ['saturday', '2026-09-05T17:00', '2026-09-05T21:00', 'parramatta'],
    ['other-campus', '2026-09-05T09:00', '2026-09-05T10:00', 'elsewhere'],
  ].map(([id, start, end, campusKey]) => createClockEvent({
    action: 'admin_create', campusKey, tutorId: 'demo-tutor', tutorName: 'Demo Tutor',
    actorName: 'Demo Admin', actorRole: 'admin', requestId: `request_${id}_123456`,
    requestFingerprint: id, targetShiftId: id, clockIn: new Date(ms(start)).toISOString(),
    clockOut: new Date(ms(end)).toISOString(), occurredAt: '2026-09-06T00:00:00.000Z',
  } as any));
  const replay = replayTimeClockEvents(events);
  const range = rangeFromSydneyDateKeys('2026-09-04', '2026-09-05');
  assert.equal(range.ok, true);
  if (!range.ok) return;
  const view = buildPayrollRange({state: {...replay, sourceFingerprint: '', rawEventCount: 3}, campusKey: 'parramatta', ...range});
  assert.equal(view.summary.length, 1);
  assert.equal(view.summary[0].premiumMinutes, 242);
  assert.equal(view.summary[0].premiumHours.toFixed(2), '4.03');
  assert.equal(view.summary[0].after7Minutes, 1);
  assert.equal(view.summary[0].saturdayMinutes, 241);
  assert.equal(view.rows.find(r => r.shiftId === 'friday')!.premiumMinutes, 2);
  const saturday = rangeFromSydneyDateKeys('2026-09-05', '2026-09-05');
  if (!saturday.ok) throw new Error(saturday.error);
  const clipped = buildPayrollRange({state: {...replay, sourceFingerprint: '', rawEventCount: 3}, campusKey: 'parramatta', ...saturday});
  assert.equal(clipped.summary[0].premiumMinutes, 241);
  assert.equal(clipped.rows.find(r => r.shiftId === 'friday')!.rangePremiumMinutes, 1);
  assert.equal(clipped.rows.find(r => r.shiftId === 'friday')!.rangeClipped, true);
  const voided = replayTimeClockEvents([...events, createClockEvent({
    action: 'admin_void', campusKey: 'parramatta', tutorId: 'demo-tutor', tutorName: 'Demo Tutor',
    actorName: 'Demo Admin', actorRole: 'admin', requestId: 'request_void_123456', requestFingerprint: 'void',
    targetShiftId: 'saturday', baseVersion: '1', reason: 'Duplicate', occurredAt: '2026-09-06T01:00:00.000Z',
  } as any)]);
  const reduced = buildPayrollRange({state: {...voided, sourceFingerprint: '', rawEventCount: 4}, campusKey: 'parramatta', ...range});
  assert.equal(reduced.summary[0].premiumMinutes, 2);
  assert.equal(reduced.adjustments.find(a => a.action === 'voided')!.oldSaturdayMinutes, 240);
});

test('CSV presents two payroll categories with one combined total and escapes formula-like names', () => {
  const csv = payrollCsv([{tutorName: ' =HYPERLINK("bad")', normalMinutes: 135, after7Minutes: 1,
    saturdayMinutes: 1, unclassifiedMinutes: 0, shifts: 2, reviewCount: 0}]);
  assert.ok(csv.includes('"Normal Hours","After 7 PM + Saturday Hours"'));
  assert.ok(csv.includes('"2.25","0.03","0.00"'));
  assert.ok(!csv.includes('"Saturday Hours"'));
  assert.ok(csv.includes('"\' =HYPERLINK(""bad"")"'));
});

test('explicit timestamps reject impossible calendar dates instead of silently rolling into another month', () => {
  for (const value of ['2026-02-30T16:00:00+11:00', '2026-09-31T17:00Z', '2026-08-31T24:00:00Z']) {
    assert.equal(parseSydneyDateTime(value).ok, false, value);
  }
  assert.equal(parseSydneyDateTime('2026-08-31T06:02:12.123Z').ok, true);
});
