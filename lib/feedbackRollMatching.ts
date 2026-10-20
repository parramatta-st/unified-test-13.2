import type { Member } from './members';
import type { TutorConfig } from './tutorConfig';

export const rollNameKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export const rollTutorName = (value: string) => value.replace(/\s*\(\s*(?:sub|substitute)\s*\)$/i, '').trim();
export const bookingLinkKey = (sessionId: string, studentId: string) => JSON.stringify([sessionId, studentId]);
export type MatchReason = 'remembered' | 'class_override' | 'student_name' | 'parent_name' | 'tutor_name' | 'tutor_first_name' | 'ambiguous_student' | 'ambiguous_parent' | 'ambiguous_tutor' | 'needs_linking' | 'saved_unavailable';
export type StudentSuggestion = { id: string; via: 'student' | 'parent' };
type Match<T> = { value: T | null; reason: MatchReason };

function indexBy<T>(values: T[], keyFor: (value: T) => string) {
  const index = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    if (key) index.set(key, [...(index.get(key) || []), value]);
  }
  return index;
}
const fullName = (member: Member) => rollNameKey(`${member.firstName} ${member.lastName}`);
const looseName = (value: string) => rollNameKey(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 200);

// Bounded edit distance, including adjacent letter swaps. Used only for review suggestions.
function spellingDistance(a: string, b: string, maximum: number) {
  if (Math.abs(a.length - b.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i), beforePrevious = previous;
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      let distance = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) distance = Math.min(distance, beforePrevious[j - 2] + 1);
      current[j] = distance;
    }
    if (Math.min(...current) > maximum) return maximum + 1;
    beforePrevious = previous; previous = current;
  }
  return previous[b.length];
}

export function createRollMatcher(campus: string, tutors: TutorConfig[], members: Member[], mappings: Map<string, string>) {
  const activeTutors = tutors.filter(tutor => tutor.active && tutor.campusKey === campus);
  const activeMembers = members.filter(member => member.active);
  const memberIds = new Map(activeMembers.map(member => [member.id, member]));
  const tutorNames = indexBy(activeTutors, tutor => rollNameKey(tutor.tutorName));
  const tutorFirstNames = indexBy(activeTutors, tutor => rollNameKey(tutor.tutorName).split(' ')[0]);
  const studentNames = indexBy(activeMembers, member => member.firstName.trim() && member.lastName.trim() ? fullName(member) : '');
  const parentNames = indexBy(activeMembers, member => rollNameKey(member.parentName));
  const suggestionCache = new Map<string, StudentSuggestion[]>();
  function tutorMatch(raw: string): Match<string> {
    const key = rollNameKey(rollTutorName(raw)), saved = mappings.get('tutor:' + key);
    if (saved !== undefined) return { value: activeTutors.some(tutor => tutor.tutorName === saved) ? saved : null, reason: saved ? activeTutors.some(tutor => tutor.tutorName === saved) ? 'remembered' : 'saved_unavailable' : 'needs_linking' };
    const exact = tutorNames.get(key) || [];
    if (exact.length) return { value: exact.length === 1 ? exact[0].tutorName : null, reason: exact.length === 1 ? 'tutor_name' : 'ambiguous_tutor' };
    const first = tutorFirstNames.get(key.split(' ')[0]) || [];
    return { value: first.length === 1 ? first[0].tutorName : null, reason: first.length === 1 ? 'tutor_first_name' : first.length > 1 ? 'ambiguous_tutor' : 'needs_linking' };
  }
  function studentMatch(student: { id: string; name: string }, sessionId?: string): Match<Member> {
    const booking = sessionId ? mappings.get('booking:' + bookingLinkKey(sessionId, student.id)) : undefined;
    const saved = booking !== undefined ? booking : mappings.get('student:' + student.id);
    if (saved !== undefined) return { value: memberIds.get(saved) || null, reason: saved ? memberIds.has(saved) ? booking !== undefined ? 'class_override' : 'remembered' : 'saved_unavailable' : 'needs_linking' };
    const key = rollNameKey(student.name), exact = studentNames.get(key) || [];
    if (exact.length) return { value: exact.length === 1 ? exact[0] : null, reason: exact.length === 1 ? 'student_name' : 'ambiguous_student' };
    const children = parentNames.get(key) || [];
    return { value: children.length === 1 ? children[0] : null, reason: children.length === 1 ? 'parent_name' : children.length > 1 ? 'ambiguous_parent' : 'needs_linking' };
  }
  function suggestStudents(name: string): StudentSuggestion[] {
    const key = rollNameKey(name), cached = suggestionCache.get(key);
    if (cached) return cached;
    // An exact ambiguous identity takes precedence over approximate alternatives.
    const exactStudents = studentNames.get(key), exactParents = parentNames.get(key);
    if (exactStudents?.length || exactParents?.length) {
      const candidates = exactStudents?.length ? exactStudents : exactParents!;
      const suggestions = candidates.map(member => ({ id: member.id, via: exactStudents?.length ? 'student' as const : 'parent' as const }));
      suggestionCache.set(key, suggestions); return suggestions;
    }
    const query = looseName(name), ranked: { id: string; via: 'student' | 'parent'; score: number }[] = [];
    if (query.length >= 4) for (const member of activeMembers) {
      let best: { id: string; via: 'student' | 'parent'; score: number } | null = null;
      for (const via of ['student', 'parent'] as const) {
        const candidate = looseName(via === 'student' ? `${member.firstName} ${member.lastName}` : member.parentName);
        if (candidate.length < 4) continue;
        const maximum = Math.min(3, Math.floor(Math.max(query.length, candidate.length) * .2));
        const distance = spellingDistance(query, candidate, maximum);
        if (distance > maximum) continue;
        const score = 1 - distance / Math.max(query.length, candidate.length);
        if (!best || score > best.score) best = { id: member.id, via, score };
      }
      if (best) ranked.push(best);
    }
    ranked.sort((a, b) => b.score - a.score || a.via.localeCompare(b.via) || a.id.localeCompare(b.id));
    const suggestions = ranked.slice(0, 5).map(({ id, via }) => ({ id, via }));
    suggestionCache.set(key, suggestions); return suggestions;
  }
  return { tutorMatch, studentMatch, suggestStudents };
}
