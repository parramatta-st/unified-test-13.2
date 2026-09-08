import { addCalendarDays, parseSydneyDateTime, sydneyDateKey, sydneyParts } from './timeClockCore';

/** The previous 14 complete Sydney calendar days, excluding today. */
export function lastCompletedFortnight(nowMs = Date.now()) {
  const today = sydneyDateKey(nowMs);
  return { from: addCalendarDays(today, -14), to: addCalendarDays(today, -1) };
}

export function localShiftInput(value: string) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const parts = sydneyParts(ms);
  return `${sydneyDateKey(ms)}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

type TimeError = { code: string; error: string };

/** Validate new admin writes. Historical ledger events retain their original times. */
export function validateAdminShiftTimes(
  startMs: number,
  endMs: number | null,
  requireEnd: boolean,
  nowMs = Date.now(),
): TimeError | null {
  if (!Number.isFinite(startMs) || (endMs !== null && !Number.isFinite(endMs))) {
    return { code: 'INVALID_DATE_TIME', error: 'Choose a valid shift date and time.' };
  }
  if (requireEnd && endMs === null) {
    return { code: 'CLOCK_OUT_REQUIRED', error: 'Enter the end time for this missed shift.' };
  }
  if (endMs !== null && endMs <= startMs) {
    return { code: 'INVALID_CLOCK_ORDER', error: 'End time must be later than start time on the same day. Check AM/PM; a shift cannot have zero or negative hours.' };
  }
  if (endMs !== null && sydneyDateKey(startMs) !== sydneyDateKey(endMs)) {
    return { code: 'SAME_DAY_REQUIRED', error: 'Start and end must be on the same shift date in Sydney. Check the date and times.' };
  }
  if (startMs > nowMs + 5 * 60_000 || (endMs !== null && endMs > nowMs + 5 * 60_000)) {
    return { code: 'FUTURE_SHIFT', error: 'Clock times cannot be more than five minutes in the future.' };
  }
  return null;
}

/** Also used in the form so invalid input is explained before submission. */
export function checkShiftEntry(clockIn: string, clockOut: string, requireEnd: boolean, nowMs = Date.now()) {
  const start = parseSydneyDateTime(clockIn);
  if (start.ok === false) return { ok: false as const, code: start.code, error: `Start time: ${start.error}` };
  const end = clockOut ? parseSydneyDateTime(clockOut) : null;
  if (end && end.ok === false) return { ok: false as const, code: end.code, error: `End time: ${end.error}` };
  const endMs = end?.ok ? end.ms : null;
  const error = validateAdminShiftTimes(start.ms, endMs, requireEnd, nowMs);
  if (error) return { ok: false as const, ...error };
  return { ok: true as const, startMs: start.ms, endMs };
}
