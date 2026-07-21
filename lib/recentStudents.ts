import type { StudentPickerValue } from '../components/StudentPicker';

export type RecentStudent = Pick<StudentPickerValue, 'id' | 'firstName' | 'lastName' | 'name' | 'email' | 'parentName' | 'year' | 'gender' | 'pronouns'>;

const KEY = 'st_recent_students_v1';
const MAX = 4;

function safeParse(raw: string | null): RecentStudent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.name === 'string' && s.name.trim())
      .map((s) => ({
        id: s.id || '',
        firstName: s.firstName || (s.name || '').split(/\s+/)[0] || '',
        lastName: s.lastName || '',
        name: s.name || '',
        email: s.email || '',
        parentName: s.parentName || '',
        year: s.year || '',
        gender: s.gender || '',
        pronouns: s.pronouns || '',
      }));
  } catch {
    return [];
  }
}

export function getRecentStudents(): RecentStudent[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(KEY)).slice(0, MAX);
}

export function rememberRecentStudent(student: Partial<RecentStudent> & { name?: string }) {
  if (typeof window === 'undefined') return;
  const name = (student.name || '').trim();
  if (!name) return;

  const next: RecentStudent = {
    id: student.id || '',
    firstName: student.firstName || name.split(/\s+/)[0] || name,
    lastName: student.lastName || '',
    name,
    email: student.email || '',
    parentName: student.parentName || '',
    year: student.year || '',
    gender: student.gender || '',
    pronouns: student.pronouns || '',
  };

  const existing = getRecentStudents();
  const key = (s: RecentStudent) => `${(s.email || '').toLowerCase()}|${s.name.toLowerCase()}`;
  const filtered = existing.filter((s) => key(s) !== key(next));
  window.localStorage.setItem(KEY, JSON.stringify([next, ...filtered].slice(0, MAX)));
}

export function clearRecentStudents() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}
