// Shared by the roster API and the successful-send UI; contains no server imports.
export type SentFeedback = { studentId: string; studentName: string; parentEmail: string; date: string };
const norm = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
function value(row: Record<string, unknown>, ...keys: string[]) {
  const wanted = new Set(keys.map(key => norm(key).replace(/[^a-z0-9]/g, '')));
  return String(Object.entries(row).find(([key, val]) => wanted.has(norm(key).replace(/[^a-z0-9]/g, '')) && String(val ?? '').trim())?.[1] ?? '').trim();
}
export function feedbackSentDate(input: unknown): string {
  const text = String(input ?? '').trim();
  // Published Sheets dates are Sydney wall time, usually M/D/YYYY.
  const sheet = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[\s,]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)?$/i);
  if (sheet) {
    const a = Number(sheet[1]), b = Number(sheet[2]), year = Number(sheet[3]) + (sheet[3].length === 2 ? 2000 : 0);
    const month = a > 12 ? b : a, day = a > 12 ? a : b;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? parsed.toISOString().slice(0, 10) : '';
  }
  // Zone-free ISO timestamps from Sheets are also local wall time.
  const local = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/);
  if (local) return local[1];
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return '';
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
export function sentFeedbackForDate(rows: Record<string, unknown>[], campus: string, date: string, legacyCampus: string): SentFeedback[] {
  return rows.flatMap(row => {
    const rowCampus = value(row, 'campusKey', 'campus') || legacyCampus;
    const status = norm(value(row, 'sendStatus', 'status'));
    // Older sent-message archives predate sendStatus; explicit pending/failed rows never count.
    if (norm(rowCampus) !== norm(campus) || (status && !['sent', 'success', 'delivered'].includes(status))) return [];
    if (feedbackSentDate(value(row, 'timestamp', 'when')) !== date) return [];
    return [{ studentId: value(row, 'studentId'), studentName: value(row, 'studentName', 'student'), parentEmail: value(row, 'parentEmail', 'email'), date }];
  });
}
export function hasSentFeedback(student: { id?: string; name: string; email?: string }, date: string, sent: SentFeedback[]): boolean {
  return sent.some(item => {
    if (item.date !== date) return false;
    if (item.studentId && student.id) return norm(item.studentId) === norm(student.id);
    // A shared parent email alone cannot distinguish siblings.
    return !!norm(student.name) && norm(item.studentName) === norm(student.name) &&
      (!item.parentEmail || !student.email || norm(item.parentEmail) === norm(student.email));
  });
}
