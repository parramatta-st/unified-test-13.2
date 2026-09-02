export const TIME_CLOCK_TIME_ZONE = 'Australia/Sydney';

export type SydneyLocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export type PaidHours = {
  normalHours: number;
  after7Hours: number;
  saturdayHours: number;
  unclassifiedHours: number;
  elapsedHours: number;
};

export type SydneyDateTimeResult =
  | { ok: true; ms: number; iso: string; source: 'instant' | 'local' }
  | {
      ok: false;
      code:
        | 'INVALID_DATE_TIME'
        | 'NONEXISTENT_LOCAL_TIME'
        | 'AMBIGUOUS_LOCAL_TIME';
      error: string;
      candidates?: string[];
    };

const partFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_CLOCK_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function roundHours(milliseconds: number) {
  return Math.round((milliseconds / 3_600_000) * 1_000_000) / 1_000_000;
}

function calendarDateIsValid(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function sydneyParts(milliseconds: number): SydneyLocalParts {
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid timestamp');
  const values: Record<string, string> = {};
  for (const part of partFormatter.formatToParts(new Date(milliseconds))) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return {
    year,
    month,
    day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    // Computing from the local calendar date avoids locale-specific weekday text.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function timeZoneOffsetMs(milliseconds: number) {
  const rounded = Math.floor(milliseconds / 1000) * 1000;
  const parts = sydneyParts(rounded);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - rounded;
}

function matchingSydneyInstants(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set<number>();
  // Sampling either side of the requested wall time discovers both offsets on
  // daylight-saving transition days without assuming Australia's DST dates.
  for (const sampleHours of [-48, -36, -24, -12, 0, 12, 24, 36, 48]) {
    offsets.add(timeZoneOffsetMs(localAsUtc + sampleHours * 3_600_000));
  }

  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = localAsUtc - offset;
    const parts = sydneyParts(candidate);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === second
    ) {
      matches.push(candidate);
    }
  }
  return Array.from(new Set(matches)).sort((a, b) => a - b);
}

export function parseSydneyDateTime(value: unknown): SydneyDateTimeResult {
  const input = String(value ?? '').trim();
  if (!input) {
    return {
      ok: false,
      code: 'INVALID_DATE_TIME',
      error: 'A date and time are required.',
    };
  }

  // An explicit Z/offset is already an unambiguous instant. This also gives an
  // admin a safe escape hatch for the repeated hour when DST ends.
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(input)) {
    const milliseconds = Date.parse(input);
    if (!Number.isFinite(milliseconds)) {
      return {
        ok: false,
        code: 'INVALID_DATE_TIME',
        error: 'The supplied timestamp is invalid.',
      };
    }
    return {
      ok: true,
      ms: milliseconds,
      iso: new Date(milliseconds).toISOString(),
      source: 'instant',
    };
  }

  const match = input.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) {
    return {
      ok: false,
      code: 'INVALID_DATE_TIME',
      error: 'Use a complete date and time in the Sydney timezone.',
    };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  if (
    !calendarDateIsValid(year, month, day) ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59 ||
    !Number.isInteger(second) ||
    second < 0 ||
    second > 59
  ) {
    return {
      ok: false,
      code: 'INVALID_DATE_TIME',
      error: 'The supplied Sydney date or time does not exist.',
    };
  }

  const matches = matchingSydneyInstants(
    year,
    month,
    day,
    hour,
    minute,
    second,
  );
  if (!matches.length) {
    return {
      ok: false,
      code: 'NONEXISTENT_LOCAL_TIME',
      error:
        'That Sydney time does not exist because the clocks move forward for daylight saving. Choose a time after the skipped hour.',
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS_LOCAL_TIME',
      error:
        'That Sydney time occurs twice because daylight saving is ending. Use an ISO timestamp with an explicit +10:00 or +11:00 offset.',
      candidates: matches.map((milliseconds) => new Date(milliseconds).toISOString()),
    };
  }
  return {
    ok: true,
    ms: matches[0],
    iso: new Date(matches[0]).toISOString(),
    source: 'local',
  };
}

export function sydneyLocalMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const result = parseSydneyDateTime(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
  );
  if (result.ok === false) throw new Error(result.error);
  return result.ms;
}

export function sydneyDateKey(milliseconds: number) {
  const parts = sydneyParts(milliseconds);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addCalendarDays(dateKey: string, days: number) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!calendarDateIsValid(year, month, day) || !Number.isInteger(days)) return '';
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function rangeFromSydneyDateKeys(fromValue: unknown, toValue: unknown) {
  const from = String(fromValue ?? '').trim();
  const to = String(toValue ?? '').trim();
  const fromMatch = from.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const toMatch = to.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!fromMatch || !toMatch) {
    return { ok: false as const, error: 'From and to must both be valid dates.' };
  }
  const fy = Number(fromMatch[1]);
  const fm = Number(fromMatch[2]);
  const fd = Number(fromMatch[3]);
  const ty = Number(toMatch[1]);
  const tm = Number(toMatch[2]);
  const td = Number(toMatch[3]);
  if (!calendarDateIsValid(fy, fm, fd) || !calendarDateIsValid(ty, tm, td)) {
    return { ok: false as const, error: 'The selected date range is invalid.' };
  }
  const startMs = sydneyLocalMs(fy, fm, fd);
  const dayAfterTo = addCalendarDays(to, 1);
  const nextMatch = dayAfterTo.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  const endMs = sydneyLocalMs(
    Number(nextMatch[1]),
    Number(nextMatch[2]),
    Number(nextMatch[3]),
  );
  if (endMs <= startMs) {
    return { ok: false as const, error: 'The to date must not be before the from date.' };
  }
  const calendarDays = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  ) + 1;
  if (calendarDays > 366) {
    return { ok: false as const, error: 'Select a date range of 366 days or fewer.' };
  }
  return { ok: true as const, from, to, startMs, endMs, calendarDays };
}

function nextLocalDay(parts: SydneyLocalParts) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function splitPaidHours(startMs: number, endMs: number): PaidHours {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      normalHours: 0,
      after7Hours: 0,
      saturdayHours: 0,
      unclassifiedHours: 0,
      elapsedHours: 0,
    };
  }

  let normalMs = 0;
  let after7Ms = 0;
  let saturdayMs = 0;
  let unclassifiedMs = 0;
  let cursor = startMs;
  let dayGuard = 0;
  while (cursor < endMs) {
    if (dayGuard++ > 3_700) throw new Error('Shift duration is too large to calculate safely.');
    const parts = sydneyParts(cursor);
    const next = nextLocalDay(parts);
    const midnight = sydneyLocalMs(next.year, next.month, next.day);
    const segmentEnd = Math.min(endMs, midnight);
    if (segmentEnd <= cursor) throw new Error('Could not advance through the shift safely.');

    if (parts.weekday === 6) {
      // Saturday always wins, including Saturday after 7 PM.
      saturdayMs += segmentEnd - cursor;
    } else if (parts.weekday >= 1 && parts.weekday <= 5) {
      const sevenPm = sydneyLocalMs(parts.year, parts.month, parts.day, 19);
      if (cursor < sevenPm) {
        normalMs += Math.max(0, Math.min(segmentEnd, sevenPm) - cursor);
      }
      if (segmentEnd > sevenPm) {
        after7Ms += Math.max(0, segmentEnd - Math.max(cursor, sevenPm));
      }
    } else {
      // Sunday is intentionally not silently labelled as a weekday or Saturday.
      // It remains visible as an exception that an admin must review.
      unclassifiedMs += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }

  return {
    normalHours: roundHours(normalMs),
    after7Hours: roundHours(after7Ms),
    saturdayHours: roundHours(saturdayMs),
    unclassifiedHours: roundHours(unclassifiedMs),
    elapsedHours: roundHours(endMs - startMs),
  };
}

export function clipInterval(
  startMs: number,
  endMs: number,
  rangeStartMs: number,
  rangeEndMs: number,
) {
  if (
    ![startMs, endMs, rangeStartMs, rangeEndMs].every(Number.isFinite) ||
    endMs <= startMs ||
    rangeEndMs <= rangeStartMs
  ) {
    return null;
  }
  const start = Math.max(startMs, rangeStartMs);
  const end = Math.min(endMs, rangeEndMs);
  return end > start ? { startMs: start, endMs: end } : null;
}

export function intervalsOverlap(
  firstStartMs: number,
  firstEndMs: number | null,
  secondStartMs: number,
  secondEndMs: number | null,
) {
  if (!Number.isFinite(firstStartMs) || !Number.isFinite(secondStartMs)) return false;
  const firstEnd = firstEndMs === null ? Number.POSITIVE_INFINITY : firstEndMs;
  const secondEnd = secondEndMs === null ? Number.POSITIVE_INFINITY : secondEndMs;
  if (!Number.isFinite(firstEnd) && firstEnd !== Number.POSITIVE_INFINITY) return false;
  if (!Number.isFinite(secondEnd) && secondEnd !== Number.POSITIVE_INFINITY) return false;
  return firstStartMs < secondEnd && secondStartMs < firstEnd;
}

export function durationHours(startMs: number, endMs: number) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return roundHours(endMs - startMs);
}
