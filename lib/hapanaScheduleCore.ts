import { addCalendarDays, parseSydneyDateTime } from './timeClockCore';

export type HapanaCapture = {
  schemaVersion: 1; campusKey: string; date: string; timeZone: 'Australia/Sydney';
  captureId: string; startedAt: string; completedAt: string;
  mode: 'observed_sessions' | 'replace_day'; excludedSessionCount: number;
  sessions: { hapanaSessionId: string; sessionTitle: string; tutorNameRaw: string; tutorName: string; startMinute: number; endMinute: number }[];
};
export type ExpectedSession = {
  sessionId: string; date: string; title: string; tutorNameRaw: string; tutorName: string;
  startAt: string; endAt: string; observedAt: string; importId: string;
};
export const normaliseHapanaName = (value: string) => String(value || '').trim().replace(/\s+/g, ' ').replace(/\s*\(\s*(?:sub|substitute)\s*\)$/i, '').trim().toLowerCase();
function checkedText(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('A schedule field is missing or too long.');
  return value.trim().replace(/\s+/g, ' ');
}
function validDate(date: string) { return /^\d{4}-\d{2}-\d{2}$/.test(date || '') && addCalendarDays(date, 0) === date; }
function instant(value: unknown) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Invalid schedule timestamp.');
  return value;
}
export function validateHapanaCapture(raw: any, campusKey: string): HapanaCapture {
  if (!raw || raw.schemaVersion !== 1 || raw.campusKey !== campusKey || raw.timeZone !== 'Australia/Sydney' || !validDate(raw.date)) throw new Error('The schedule date or campus does not match this portal.');
  const captureId = checkedText(raw.captureId, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(captureId)) throw new Error('Invalid capture ID.');
  const startedAt = instant(raw.startedAt), completedAt = instant(raw.completedAt);
  if (completedAt < startedAt || !['observed_sessions', 'replace_day'].includes(raw.mode)) throw new Error('Invalid collection metadata.');
  if (!Array.isArray(raw.sessions) || !raw.sessions.length || raw.sessions.length > 500) throw new Error('Collect a complete non-empty day before syncing.');
  if (!Number.isInteger(raw.excludedSessionCount) || raw.excludedSessionCount < 0 || raw.excludedSessionCount > 500) throw new Error('Invalid excluded-session count.');
  const sessions = raw.sessions.map((s: any) => {
    const hapanaSessionId = checkedText(s.hapanaSessionId, 80);
    if (!new RegExp(`^${raw.date}:\\d+:\\d+$`).test(hapanaSessionId)) throw new Error('A session belongs to another day.');
    if (!Number.isInteger(s.startMinute) || !Number.isInteger(s.endMinute) || s.startMinute < 0 || s.endMinute > 1440 || s.endMinute <= s.startMinute) throw new Error('Invalid scheduled session times.');
    const tutorNameRaw = checkedText(s.tutorNameRaw, 180);
    const tutorName = tutorNameRaw.replace(/\s*\(\s*(?:sub|substitute)\s*\)$/i, '').trim();
    if (!tutorName || /^(unassigned|not assigned|no instructor|tbc|tbd|none|n\/a)$/i.test(tutorName)) throw new Error('A session has no assigned tutor.');
    return { hapanaSessionId, sessionTitle: checkedText(s.sessionTitle, 180), tutorNameRaw, tutorName, startMinute: s.startMinute, endMinute: s.endMinute };
  }).sort((a: any,b: any) => a.startMinute - b.startMinute || a.hapanaSessionId.localeCompare(b.hapanaSessionId));
  if (new Set(sessions.map((s: any) => s.hapanaSessionId)).size !== sessions.length) throw new Error('Duplicate session IDs.');
  return { schemaVersion: 1, campusKey, date: raw.date, timeZone: 'Australia/Sydney', captureId, startedAt, completedAt, mode: raw.mode, excludedSessionCount: raw.excludedSessionCount, sessions };
}
export function expectedSessions(capture: HapanaCapture): ExpectedSession[] {
  const at = (minute: number) => {
    const date = minute === 1440 ? addCalendarDays(capture.date, 1) : capture.date;
    const value = `${date}T${String(Math.floor((minute % 1440) / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
    const parsed = parseSydneyDateTime(value);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.iso;
  };
  return capture.sessions.map(s => ({sessionId:s.hapanaSessionId,date:capture.date,title:s.sessionTitle,tutorNameRaw:s.tutorNameRaw,tutorName:s.tutorName,startAt:at(s.startMinute),endAt:at(s.endMinute),observedAt:capture.completedAt,importId:capture.captureId}));
}
export function missingClockIns(options: {
  sessions: ExpectedSession[]; campusKey: string; nowMs: number;
  resolveTutor: (name: string) => { tutorId: string; tutorName: string } | null;
  shifts: {campusKey: string; tutorId: string; tutorName: string; clockIn: string; clockOut: string; status: string}[];
}) {
  const missing: (ExpectedSession & { tutorId: string; tutorName: string })[] = [], unmapped = new Set<string>();
  for (const session of options.sessions) {
    const start = Date.parse(session.startAt), end = Date.parse(session.endAt);
    if (options.nowMs < start + 20 * 60_000) continue;
    const tutor = options.resolveTutor(session.tutorNameRaw);
    if (!tutor) { unmapped.add(session.tutorNameRaw); continue; }
    const found = options.shifts.some(shift => {
      if (shift.status === 'voided' || shift.campusKey.toLowerCase() !== options.campusKey.toLowerCase() || shift.tutorId !== tutor.tutorId) return false;
      const clockIn = Date.parse(shift.clockIn), clockOut = shift.clockOut ? Date.parse(shift.clockOut) : options.nowMs;
      return Number.isFinite(clockIn) && Number.isFinite(clockOut) && clockIn <= options.nowMs && clockOut > clockIn && clockIn < end && clockOut > start;
    });
    if (!found) missing.push({...session,...tutor});
  }
  // Deliberately never iterate over shifts to accuse unscheduled markers.
  return {missing,unmapped:[...unmapped]};
}
