import crypto from 'node:crypto';
import { appendSheetRows, getSpreadsheet, googleSheetsCredentialsConfigured, readSheetRows, spreadsheetIdFor } from './googleSheets';
import type { Member } from './members';
import type { TutorConfig } from './tutorConfig';
import { scheduleDate } from './feedbackSchedule';

const SHEET = 'feedback_roll_events';
const HEADERS = ['eventId', 'campus', 'date', 'captureId', 'type', 'issuedAt', 'savedAt', 'actor', 'payload', 'signature'];
export const nameKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export const sourceTutor = (value: string) => value.replace(/\s*\(\s*(?:sub|substitute)\s*\)$/i, '').trim();
export type RollSession = { hapanaSessionId: string; sessionTitle: string; tutorNameRaw: string; startMinute: number; endMinute: number; students: { id: string; name: string }[] };
export type RollCapture = { schemaVersion: 2; date: string; captureId: string; mode: 'replace_day' | 'observed_sessions'; sessions: RollSession[] };
type Event = { eventId: string; campus: string; date: string; captureId: string; type: string; issuedAt: string; savedAt: string; actor: string; payload: string; signature: string };
export class RollsError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(message: string): never { throw new RollsError(400, message); }
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) return fail(`Invalid ${label}.`);
  return value.replace(/\s+/g, ' ').trim();
}
function secret() {
  const value = process.env.SESSION_SECRET?.trim() || process.env.TUTOR_PASSWORD?.trim();
  if (!value) throw new RollsError(503, 'Portal sessions are not configured.');
  return 'st-feedback-rolls-v1:' + value;
}
function sign(value: string) { return crypto.createHmac('sha256', secret()).update(value).digest('hex'); }
function matches(value: string, expected: string) { return /^[a-f0-9]{64}$/.test(value) && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected)); }
function hash(value: unknown) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function rollSpreadsheetId() { return spreadsheetIdFor('TIMETABLE'); }
export function rollSyncConfigured() { return googleSheetsCredentialsConfigured() && !!rollSpreadsheetId(); }
export function rollCampusEnabled(campus: string) { return campus === 'parramatta'; }
export function validateRollCapture(raw: any): RollCapture {
  if (raw?.schemaVersion !== 2 || typeof raw.date !== 'string' || !scheduleDate(raw.date)) return fail('Invalid Feedback schedule version or date.');
  const captureId = text(raw.captureId, 'collection ID', 100);
  if (!/^[A-Za-z0-9_-]+$/.test(captureId)) return fail('Invalid collection ID.');
  if (!['replace_day', 'observed_sessions'].includes(raw.mode)) return fail('Invalid collection mode.');
  if (!Array.isArray(raw.sessions) || !raw.sessions.length || raw.sessions.length > 500) return fail('Collect a non-empty, verified day before syncing.');
  let total = 0;
  const sessions: RollSession[] = raw.sessions.map((row: any) => {
    const hapanaSessionId = text(row?.hapanaSessionId, 'Hapana class ID', 80);
    if (!new RegExp(`^${raw.date}:\\d+:\\d+$`).test(hapanaSessionId)) return fail('A class ID does not match the selected date.');
    const { startMinute, endMinute } = row;
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute < 0 || endMinute > 1439 || endMinute <= startMinute) return fail('Invalid class times.');
    if (!Array.isArray(row.students) || row.students.length > 200) return fail('Invalid student list.');
    total += row.students.length;
    const students = row.students.map((student: any) => ({ id: text(student?.id, 'Hapana student ID', 80), name: text(student?.name, 'student name') })).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
    if (new Set(students.map((s: { id: string }) => s.id)).size !== students.length) return fail('Duplicate student IDs in one class.');
    const tutorNameRaw = text(row.tutorNameRaw, 'instructor name');
    if (/^(?:unassigned|not assigned|no instructor|tbc|tbd|none|n\/a)$/i.test(sourceTutor(tutorNameRaw))) return fail('An assigned instructor is required.');
    const session = { hapanaSessionId, sessionTitle: text(row.sessionTitle, 'class title'), tutorNameRaw, startMinute, endMinute, students };
    if (JSON.stringify(session).length > 45000) return fail('This class is too large to sync safely.');
    return session;
  }).sort((a: RollSession, b: RollSession) => a.hapanaSessionId.localeCompare(b.hapanaSessionId));
  if (total > 5000 || new Set(sessions.map(s => s.hapanaSessionId)).size !== sessions.length) return fail('Too many bookings or duplicate class IDs.');
  return { schemaVersion: 2, date: raw.date, captureId, mode: raw.mode, sessions };
}

export function collectionTicket(campus: string, actor: string, date: string, captureId: string, now = Date.now()) {
  if (!scheduleDate(date) || !/^[A-Za-z0-9_-]{1,100}$/.test(captureId)) return fail('Invalid collection date or ID.');
  const payload = Buffer.from(JSON.stringify({ campus, actor, date, captureId, issuedAt: now, expiresAt: now + 2 * 3600000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readTicket(ticket: unknown, campus: string, actor: string, capture: RollCapture) {
  if (typeof ticket !== 'string' || ticket.length > 2000) return fail('Collect again while signed in as an admin.');
  const [payload, signature, extra] = ticket.split('.');
  if (extra || !signature || !matches(signature, sign(payload))) return fail('Invalid collection confirmation. Collect again.');
  let data; try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return fail('Invalid collection confirmation.'); }
  if (data.campus !== campus || data.actor !== actor || data.date !== capture.date || data.captureId !== capture.captureId || data.expiresAt <= Date.now() || !Number.isSafeInteger(data.issuedAt) || data.issuedAt > Date.now()) return fail('The collection expired or admin changed. Collect again.');
  return data as { issuedAt: number };
}
function eventContent(row: Omit<Event, 'signature'>) { return JSON.stringify(HEADERS.slice(0, -1).map(key => row[key as keyof typeof row])); }
function event(type: string, campus: string, actor: string, date: string, captureId: string, issuedAt: number, payload: unknown): Event {
  const row = { eventId: crypto.randomUUID(), campus, actor, date, captureId, type, issuedAt: String(issuedAt), savedAt: new Date().toISOString(), payload: JSON.stringify(payload) };
  return { ...row, signature: sign(eventContent(row)) };
}
export async function readRollEvents(): Promise<Event[]> {
  if (!rollSyncConfigured()) return [];
  const meta = await getSpreadsheet(rollSpreadsheetId());
  if (!(meta.sheets || []).some((sheet: any) => sheet?.properties?.title === SHEET)) return [];
  const rows = await readSheetRows(SHEET, rollSpreadsheetId());
  return rows.filter(row => {
    try { return typeof row.signature === 'string' && matches(row.signature, sign(eventContent(row as Event))); } catch { return false; }
  }) as Event[];
}
export function rollState(events: Event[], campus: string, date: string) {
  const scoped = events.filter(row => row.campus === campus);
  const sessions = new Map<string, RollSession>();
  const commits: { row: Event; capture: RollCapture; digest: string }[] = [];
  for (const row of scoped.filter(row => row.type === 'commit' && row.date === date)) {
    try {
      const manifest = JSON.parse(row.payload);
      const parts = scoped.filter(part => part.type === 'session' && part.date === date && part.captureId === row.captureId && part.issuedAt === row.issuedAt && part.actor === row.actor);
      const unique = new Map(parts.map(part => { const session = JSON.parse(part.payload) as RollSession; return [session.hapanaSessionId, session]; }));
      const capture = validateRollCapture({ schemaVersion: 2, date, captureId: row.captureId, mode: manifest.mode, sessions: [...unique.values()] });
      if (capture.sessions.length !== manifest.count || hash(capture) !== manifest.digest) continue;
      commits.push({ row, capture, digest: manifest.digest });
    } catch { /* Incomplete or edited captures never replace the last good day. */ }
  }
  commits.sort((a, b) => Number(a.row.issuedAt) - Number(b.row.issuedAt) || a.row.captureId.localeCompare(b.row.captureId));
  for (const { capture } of commits) {
    if (capture.mode === 'replace_day') sessions.clear();
    for (const session of capture.sessions) sessions.set(session.hapanaSessionId, session);
  }
  const mappings = new Map<string, string>();
  for (const row of scoped.filter(row => row.type === 'link').sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.eventId.localeCompare(b.eventId))) {
    try { const link = JSON.parse(row.payload); mappings.set(link.kind + ':' + link.source, link.target); } catch {}
  }
  return { sessions: [...sessions.values()], commits, mappings, latest: commits.at(-1)?.row || null };
}
export async function importRolls(raw: unknown, ticket: unknown, campus: string, actor: string) {
  const capture = validateRollCapture(raw), confirmation = readTicket(ticket, campus, actor, capture);
  const state = rollState(await readRollEvents(), campus, capture.date);
  const previous = state.commits.find(item => item.capture.captureId === capture.captureId);
  if (previous) {
    if (previous.digest !== hash(capture)) throw new RollsError(409, 'This collection ID already has different bookings. Collect again.');
    if (state.latest && Number(previous.row.issuedAt) < Number(state.latest.issuedAt)) throw new RollsError(409, 'A newer collection has already synced. Collect this day again.');
    return { replayed: true, capture };
  }
  if (state.latest && confirmation.issuedAt < Number(state.latest.issuedAt)) throw new RollsError(409, 'A newer collection has already synced. Collect this day again.');
  const rows = capture.sessions.map(session => event('session', campus, actor, capture.date, capture.captureId, confirmation.issuedAt, session));
  rows.push(event('commit', campus, actor, capture.date, capture.captureId, confirmation.issuedAt, { mode: capture.mode, count: capture.sessions.length, digest: hash(capture) }));
  await appendSheetRows(SHEET, HEADERS, rows, rollSpreadsheetId());
  return { replayed: false, capture };
}
export async function saveRollLink(campus: string, actor: string, kind: unknown, source: unknown, target: unknown, tutors: TutorConfig[], members: Member[]) {
  if (kind !== 'tutor' && kind !== 'student') return fail('Invalid link type.');
  const key = text(source, 'source identity', 200), chosen = typeof target === 'string' ? target.trim() : fail('Invalid linked identity.');
  if (chosen && !(kind === 'tutor' ? tutors.some(t => t.active && t.campusKey === campus && t.tutorName === chosen) : members.some(m => m.active && m.id === chosen))) return fail('Choose an active portal account or member.');
  await appendSheetRows(SHEET, HEADERS, [event('link', campus, actor, '', '', Date.now(), { kind, source: key, target: chosen })], rollSpreadsheetId());
}
export function linkedRoster(state: ReturnType<typeof rollState>, campus: string, tutors: TutorConfig[], members: Member[]) {
  const activeTutors = tutors.filter(t => t.active && t.campusKey === campus), activeMembers = members.filter(m => m.active);
  function tutorFor(raw: string) {
    const key = nameKey(sourceTutor(raw)), linked = state.mappings.get('tutor:' + key);
    const candidates = activeTutors.filter(t => linked !== undefined ? t.tutorName === linked : nameKey(t.tutorName) === key);
    return candidates.length === 1 ? candidates[0].tutorName : '';
  }
  function memberFor(student: { id: string; name: string }) {
    const linked = state.mappings.get('student:' + student.id);
    const candidates = activeMembers.filter(m => linked !== undefined ? m.id === linked : nameKey(`${m.firstName} ${m.lastName}`) === nameKey(student.name));
    return candidates.length === 1 ? candidates[0] : null;
  }
  const rows = state.sessions.flatMap(session => session.students.map(student => {
    const member = memberFor(student);
    return { campusKey: campus, tutorName: tutorFor(session.tutorNameRaw), specificDate: state.latest?.date, entryType: 'one_off', startTime: minuteTime(session.startMinute), endTime: minuteTime(session.endMinute), studentId: member?.id || '', studentName: student.name, active: true };
  }));
  return { rows, tutorFor, memberFor };
}
export function minuteTime(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`; }
