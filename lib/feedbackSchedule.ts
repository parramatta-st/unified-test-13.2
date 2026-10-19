import type { Member } from './members';

const norm = (value: unknown) => String(value ?? '').trim();
const lower = (value: unknown) => norm(value).toLowerCase();
function value(row: any, ...keys: string[]) {
  for (const key of keys) if (norm(row[key])) return norm(row[key]);
  return '';
}
export function scheduleDate(input: unknown) {
  const date = norm(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}
export function scheduleTime(input: unknown) {
  const text = lower(input).replace(/\s+/g, '');
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/) || text.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (!match) return '';
  let hour = Number(match[1]); const minute = Number(match[2] || 0);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return '';
  if (match[3]) hour = hour % 12 + (match[3] === 'pm' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function label(time: string) {
  const [hour, minute] = time.split(':'); const h = Number(hour);
  return `${h % 12 || 12}:${minute}${h >= 12 ? 'pm' : 'am'}`;
}
export function feedbackScheduleSessions(rows: any[], members: Member[], campus: string, tutor: string, date: string) {
  if (!scheduleDate(date)) return [];
  const day = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long' }).format(new Date(`${date}T12:00:00Z`));
  const memberMap = new Map(members.filter(member => member.active).map(member => [lower(member.id), member]));
  const groups = new Map<string, { key: string; startTime: string; endTime: string; startLabel: string; endLabel: string; students: any[] }>();
  for (const row of rows) {
    if (['false', '0', 'no', 'inactive', 'off'].includes(lower(row.active))) continue;
    // Derive identity from the verified session. Never accept another tutor or
    // campus supplied in a query string, and never broaden first-name matches.
    if (lower(value(row, 'campusKey', 'CampusKey', 'campus')) !== lower(campus)) continue;
    if (lower(value(row, 'tutorName', 'Tutor', 'tutor')) !== lower(tutor)) continue;
    const specificDate = value(row, 'specificDate', 'date', 'Date');
    const type = lower(row.entryType || (specificDate ? 'one_off' : 'weekly'));
    if (!['weekly', 'one_off'].includes(type)) continue;
    if (type === 'one_off' ? specificDate !== date : lower(value(row, 'dayOfWeek', 'Day')).slice(0, 3) !== day.toLowerCase().slice(0, 3)) continue;
    const startTime = scheduleTime(value(row, 'startTime', 'Start'));
    const endTime = scheduleTime(value(row, 'endTime', 'End'));
    if (!startTime || !endTime || endTime <= startTime) continue;
    const studentId = value(row, 'studentId', 'StudentID');
    const member = memberMap.get(lower(studentId));
    const name = member ? `${member.firstName} ${member.lastName}`.trim() : value(row, 'studentName', 'Student');
    if (!name) continue;
    const key = `${startTime}|${endTime}`;
    if (!groups.has(key)) groups.set(key, { key, startTime, endTime, startLabel: label(startTime), endLabel: label(endTime), students: [] });
    const students = groups.get(key)!.students;
    if (students.some(student => lower(student.id || student.name) === lower(studentId || name))) continue;
    students.push({ id: member?.id || studentId, memberMatched: !!member, name,
      firstName: member?.firstName || '', lastName: member?.lastName || '', email: member?.parentEmail || '', parentName: member?.parentName || '',
      year: member?.years || '', gender: member?.gender || '', pronouns: '', isMakeup: row.isMakeup === undefined ? type === 'one_off' : ['true', '1', 'yes'].includes(lower(row.isMakeup)),
    });
  }
  return [...groups.values()].map(group => ({ ...group, students: group.students.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
}
