import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackSentDate, hasSentFeedback, sentFeedbackForDate } from '../lib/feedbackSentStatus';
const day = '2026-10-20';
const student = { id: 's1', name: 'Demo Student', email: 'parent@example.invalid' };
const base = { campusKey: 'parramatta', studentId: 's1', studentName: 'Demo Student', parentEmail: student.email, timestamp: '2026-10-19T22:00:00Z', sendStatus: 'sent' };
test('sent outlines use Sydney calendar dates across midnight, Sheets wall time and daylight saving', () => {
 assert.equal(feedbackSentDate(base.timestamp), day);
 assert.equal(feedbackSentDate('2026-10-20T13:01:00Z'), '2026-10-21');
 assert.equal(feedbackSentDate('10/20/2026 23:59:00'), day);
 assert.equal(feedbackSentDate('20/10/2026 4:00 pm'), day);
 assert.equal(feedbackSentDate('2026-10-20 23:59:00'), day);
 assert.equal(feedbackSentDate('2026-06-01T14:01:00Z'), '2026-06-02');
 assert.equal(feedbackSentDate('2/31/2026 4:00 pm'), '');
 assert.equal(feedbackSentDate('not a timestamp'), '');
});
test('only successful feedback from the requested centre and date marks a student, regardless of tutor', () => {
 const rows = [base, ...['failed', 'error', 'pending', 'queued'].map(sendStatus => ({ ...base, studentId: sendStatus, sendStatus })),
  { ...base, studentId: 'other-centre', campusKey: 'epping' }, { ...base, studentId: 'yesterday', timestamp: '2026-10-18T22:00:00Z' }];
 const sent = sentFeedbackForDate(rows, 'parramatta', day, 'parramatta');
 assert.equal(sent.length, 1);
 assert.ok(hasSentFeedback(student, day, sent));
 assert.ok(!hasSentFeedback(student, '2026-10-21', sent));
 assert.ok(hasSentFeedback({ ...student, name: 'Updated Name' }, day, sent));
});
test('legacy logs require the default centre and full student identity; siblings do not share a marker', () => {
 const sent = sentFeedbackForDate([{ Timestamp: '10/20/2026 16:00:00', Student: 'Demo Student', Email: student.email }], 'parramatta', day, 'parramatta');
 assert.ok(hasSentFeedback(student, day, sent));
 assert.ok(!hasSentFeedback({ ...student, id: 's2', name: 'Sibling Student' }, day, sent));
 assert.ok(!hasSentFeedback({ ...student, email: 'different@example.invalid' }, day, sent));
 assert.equal(sentFeedbackForDate([{ ...base, campusKey: '' }], 'epping', day, 'parramatta').length, 0);
 assert.ok(!hasSentFeedback(student, day, [{ studentId: 'wrong-id', studentName: student.name, parentEmail: student.email, date: day }]));
});
