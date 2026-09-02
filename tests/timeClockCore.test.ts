import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipInterval,
  intervalsOverlap,
  parseSydneyDateTime,
  rangeFromSydneyDateKeys,
  splitPaidHours,
} from '../lib/timeClockCore';

function ms(value: string) {
  return Date.parse(value);
}

function expectHours(
  start: string,
  end: string,
  expected: Partial<ReturnType<typeof splitPaidHours>>,
) {
  const actual = splitPaidHours(ms(start), ms(end));
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key as keyof typeof actual], value, key);
  }
  assert.equal(
    actual.normalMinutes +
      actual.after7Minutes +
      actual.saturdayMinutes +
      actual.unclassifiedMinutes,
    actual.elapsedMinutes,
    'integer minute categories must be mutually exclusive and exhaustive',
  );
  assert.equal(
    Number(
      (
        actual.normalHours +
        actual.after7Hours +
        actual.saturdayHours +
        actual.unclassifiedHours
      ).toFixed(6),
    ),
    actual.elapsedHours,
    'categories must be mutually exclusive and exhaustive',
  );
}

test('splits a Monday 5 PM to 9 PM shift at 7 PM', () => {
  expectHours('2026-08-31T17:00:00+10:00', '2026-08-31T21:00:00+10:00', {
    normalHours: 2,
    after7Hours: 2,
    saturdayHours: 0,
    unclassifiedHours: 0,
    elapsedHours: 4,
  });
});

test('splits a Monday 6:30 PM to 7:30 PM shift evenly', () => {
  expectHours('2026-08-31T18:30:00+10:00', '2026-08-31T19:30:00+10:00', {
    normalHours: 0.5,
    after7Hours: 0.5,
    saturdayHours: 0,
  });
});

test('stores payroll as whole minutes and derives display hours from them', () => {
  const actual = splitPaidHours(
    ms('2026-08-31T18:30:20+10:00'),
    ms('2026-08-31T19:30:50+10:00'),
  );
  assert.equal(actual.elapsedMinutes, 61);
  assert.equal(actual.normalMinutes, 30);
  assert.equal(actual.after7Minutes, 31);
  assert.equal(actual.normalHours, 0.5);
  assert.equal(actual.after7Hours, 0.516667);
});

test('assigns every Saturday hour to Saturday, including after 7 PM', () => {
  expectHours('2026-09-05T09:00:00+10:00', '2026-09-05T15:30:00+10:00', {
    normalHours: 0,
    after7Hours: 0,
    saturdayHours: 6.5,
  });
  expectHours('2026-09-05T17:00:00+10:00', '2026-09-05T21:00:00+10:00', {
    normalHours: 0,
    after7Hours: 0,
    saturdayHours: 4,
  });
});

test('splits a Friday-to-Saturday overnight shift at Sydney midnight', () => {
  expectHours('2026-09-04T23:00:00+10:00', '2026-09-05T02:00:00+10:00', {
    normalHours: 0,
    after7Hours: 1,
    saturdayHours: 2,
    elapsedHours: 3,
  });
});

test('does not silently categorise Sunday under a weekday pay band', () => {
  expectHours('2026-09-06T10:00:00+10:00', '2026-09-06T12:00:00+10:00', {
    normalHours: 0,
    after7Hours: 0,
    saturdayHours: 0,
    unclassifiedHours: 2,
  });
});

test('uses elapsed time correctly across both Sydney DST transitions', () => {
  // Spring forward: 1:30 AM to 3:30 AM is one real hour.
  expectHours('2026-10-04T01:30:00+10:00', '2026-10-04T03:30:00+11:00', {
    unclassifiedHours: 1,
    elapsedHours: 1,
  });
  // Fall back: 1:30 AM to 3:30 AM is three real hours.
  expectHours('2026-04-05T01:30:00+11:00', '2026-04-05T03:30:00+10:00', {
    unclassifiedHours: 3,
    elapsedHours: 3,
  });
});

test('rejects nonexistent, ambiguous, and invalid Sydney local times', () => {
  const nonexistent = parseSydneyDateTime('2026-10-04T02:30');
  assert.equal(nonexistent.ok, false);
  if (!nonexistent.ok) assert.equal(nonexistent.code, 'NONEXISTENT_LOCAL_TIME');

  const ambiguous = parseSydneyDateTime('2026-04-05T02:30');
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) {
    assert.equal(ambiguous.code, 'AMBIGUOUS_LOCAL_TIME');
    assert.equal(ambiguous.candidates?.length, 2);
  }

  const invalid = parseSydneyDateTime('2026-02-30T10:00');
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'INVALID_DATE_TIME');
});

test('accepts an explicit offset during the repeated DST hour', () => {
  const daylight = parseSydneyDateTime('2026-04-05T02:30:00+11:00');
  const standard = parseSydneyDateTime('2026-04-05T02:30:00+10:00');
  assert.equal(daylight.ok, true);
  assert.equal(standard.ok, true);
  if (daylight.ok && standard.ok) assert.equal(standard.ms - daylight.ms, 3_600_000);
});

test('builds inclusive Sydney ranges without assuming every day has 24 hours', () => {
  const range = rangeFromSydneyDateKeys('2026-04-04', '2026-04-05');
  assert.equal(range.ok, true);
  if (range.ok) {
    assert.equal(range.calendarDays, 2);
    assert.equal(range.endMs - range.startMs, 49 * 3_600_000);
  }
  assert.equal(rangeFromSydneyDateKeys('2026-09-03', '2026-09-02').ok, false);
  assert.equal(rangeFromSydneyDateKeys('2026-02-30', '2026-03-01').ok, false);
});

test('clips shifts at range boundaries and treats touching shifts as non-overlapping', () => {
  assert.deepEqual(clipInterval(0, 10, 3, 7), { startMs: 3, endMs: 7 });
  assert.equal(clipInterval(0, 3, 3, 7), null);
  assert.equal(intervalsOverlap(0, 3, 3, 7), false);
  assert.equal(intervalsOverlap(0, 4, 3, 7), true);
  assert.equal(intervalsOverlap(5, null, 7, 8), true);
});
