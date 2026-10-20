import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingLinkKey, createRollMatcher } from '../lib/feedbackRollMatching';
import type { Member } from '../lib/members';
import type { TutorConfig } from '../lib/tutorConfig';
const child = (id: string, firstName: string, lastName: string, parentName = ''): Member => ({ id, firstName, lastName, parentName, parentEmail: 'fixture@example.invalid', active: true, years: 'Year 4', gender: '' });
const tutor = (tutorName: string, campusKey = 'parramatta', active = true): TutorConfig => ({ tutorName, campusKey, active, campusName: '', role: 'tutor', email: '' });
const source = (name: string) => ({ id: 'hapana-1', name });
const match = (members: Member[], mappings = new Map<string, string>(), tutors: TutorConfig[] = []) => createRollMatcher('parramatta', tutors, members, mappings);

test('unique tutor first names match in either full/short direction, ignoring substitute suffix and case', () => {
  assert.equal(match([], undefined, [tutor('Sai')]).tutorMatch('  SAI Arulanathan (sub) ').value, 'Sai');
  assert.equal(match([], undefined, [tutor('Laurise Dasouqi')]).tutorMatch('Laurise').value, 'Laurise Dasouqi');
  assert.equal(match([], undefined, [tutor('Sai')]).tutorMatch('Saif Ahmed').value, null);
});
test('duplicate first names require review, full-name identity wins, other campuses/inactive accounts do not match', () => {
  const m = match([], undefined, [tutor('Sai One'), tutor('Sai Two'), tutor('Kevin', 'other'), tutor('Laurise', 'parramatta', false)]);
  assert.equal(m.tutorMatch('Sai Three').value, null); assert.equal(m.tutorMatch('Sai Three').reason, 'ambiguous_tutor');
  assert.equal(m.tutorMatch('Sai Two').value, 'Sai Two');
  assert.equal(m.tutorMatch('Kevin Abu').value, null); assert.equal(m.tutorMatch('Laurise Dasouqi').value, null);
});
test('explicit tutor links override automatic first/full name matches, including held unresolved names', () => {
  const m = match([], new Map([['tutor:sai arulanathan', 'Second Tutor'], ['tutor:laurise dasouqi', '']]), [tutor('Sai'), tutor('Second Tutor'), tutor('Laurise')]);
  assert.equal(m.tutorMatch('Sai Arulanathan').value, 'Second Tutor'); assert.equal(m.tutorMatch('Laurise Dasouqi').value, null);
});
test('student full-name match has priority over another member’s identical parent name', () => {
  const student = child('s1', 'Example', 'Student'), other = child('s2', 'Different', 'Child', 'Example Student');
  const result = match([student, other]).studentMatch(source(' example   STUDENT '));
  assert.equal(result.value?.id, 's1'); assert.equal(result.reason, 'student_name');
});
test('an exact unique parent name automatically selects their active child', () => {
  const member = child('s1', 'Vishnuchith', 'Example', 'Balakrishnan Ramalingam');
  const result = match([member]).studentMatch(source('balakrishnan  ramalingam'));
  assert.equal(result.value?.id, 's1'); assert.equal(result.reason, 'parent_name');
});
test('siblings and duplicate full student names remain unresolved and get explicit candidates', () => {
  const m = match([child('a', 'First', 'Child', 'Shared Parent'), child('b', 'Second', 'Child', 'Shared Parent')]);
  assert.equal(m.studentMatch(source('Shared Parent')).reason, 'ambiguous_parent');
  assert.equal(m.studentMatch(source('Shared Parent')).value, null);
  assert.deepEqual(m.suggestStudents('Shared Parent').map(value => value.id), ['a', 'b']);
  const duplicates = match([child('a', 'Same', 'Student'), child('b', 'Same', 'Student'), child('c', 'Other', 'Child', 'Same Student')]);
  assert.equal(duplicates.studentMatch(source('Same Student')).value, null);
  assert.deepEqual(duplicates.suggestStudents('Same Student').map(value => value.id), ['a', 'b']);
});
test('spelling differences and adjacent letter swaps suggest students/parents without ever auto-linking', () => {
  const m = match([child('a', 'Aaradhya', 'Gupta'), child('b', 'Example', 'Child', 'Balakrishnan Ramalingam')]);
  assert.equal(m.studentMatch(source('Aaradhya Gupat')).value, null);
  assert.deepEqual(m.suggestStudents('Aaradhya Gupat'), [{ id: 'a', via: 'student' }]);
  assert.equal(m.studentMatch(source('Balakrishnan Ramalingm')).value, null);
  assert.deepEqual(m.suggestStudents('Balakrishnan Ramalingm'), [{ id: 'b', via: 'parent' }]);
  assert.deepEqual(m.suggestStudents('Completely Unrelated'), []);
});
test('punctuation and accents can generate suggestions but never silently change exact matching', () => {
  const m = match([child('a', 'Anne-Marie', 'D’Souza'), child('b', 'José', 'Example')]);
  assert.equal(m.studentMatch(source('Anne Marie Dsouza')).value, null);
  assert.equal(m.suggestStudents('Anne Marie Dsouza')[0].id, 'a');
  assert.equal(m.studentMatch(source('Jose Example')).value, null);
  assert.equal(m.suggestStudents('Jose Example')[0].id, 'b');
});
test('remembered Hapana identity wins over new exact-name matches, while class-specific sibling overrides win locally', () => {
  const a = child('a', 'First', 'Child'), b = child('b', 'Second', 'Child');
  const m = match([a, b], new Map([['student:hapana-1', 'a'], ['booking:' + bookingLinkKey('today:1:1', 'hapana-1'), 'b']]));
  assert.equal(m.studentMatch(source('Second Child'), 'tomorrow:1:1').value?.id, 'a');
  assert.equal(m.studentMatch(source('Second Child'), 'today:1:1').value?.id, 'b');
  assert.equal(m.studentMatch({ id: 'another-id', name: 'Unknown Name' }).value, null);
});
test('inactive/removed saved students require review instead of falling through to a different automatic identity', () => {
  const inactive = { ...child('a', 'First', 'Child', 'Parent Example'), active: false };
  const m = match([inactive, child('b', 'Second', 'Child')], new Map([['student:hapana-1', 'a']]));
  assert.equal(m.studentMatch(source('Second Child')).value, null);
  assert.equal(m.studentMatch(source('Second Child')).reason, 'saved_unavailable');
  assert.deepEqual(m.suggestStudents('Parent Example'), []);
});
test('first names alone never auto-link students and short unrelated spellings do not yield suggestions', () => {
  const m = match([child('a', 'Same', 'Student'), child('b', 'Only', '')]);
  assert.equal(m.studentMatch(source('Same')).value, null); assert.equal(m.studentMatch(source('Only')).value, null);
  assert.deepEqual(m.suggestStudents('Al'), []);
});
