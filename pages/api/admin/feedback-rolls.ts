import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../lib/adminAuth';
import { getActiveTutors } from '../../../lib/tutorConfig';
import { loadMembers } from '../../../lib/members';
import { scheduleDate } from '../../../lib/feedbackSchedule';
import { collectionTicket, importRolls, linkedRoster, minuteTime, nameKey, readRollEvents, rollCampusEnabled, rollState, rollSyncConfigured, RollsError, saveRollLink, sourceTutor } from '../../../lib/feedbackRolls';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const admin = await requireAdmin(req);
  if (!admin.authed) return res.status(401).json({ ok: false, error: 'Sign in to the portal as an admin, then collect again.' });
  if (!admin.isAdmin || !rollCampusEnabled(admin.campus)) return res.status(403).json({ ok: false, error: 'Parramatta admin access is required to sync Daily Rolls.' });
  if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if ((origin && origin !== `https://${req.headers.host}` && origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ ok: false, error: 'Use the signed-in portal to sync.' });
    if (process.env.VERCEL_ENV === 'preview' && process.env.FEEDBACK_ROLLS_ISOLATED_TEST !== '1') return res.status(403).json({ ok: false, error: 'Use the production portal for Daily Rolls sync.' });
  }
  try {
    if (!rollSyncConfigured()) throw new RollsError(503, 'The portal needs its private Google Sheets connection to save Daily Rolls.');
    const body = req.body || {};
    if (req.method === 'POST' && body.action === 'begin_feedback_collection') {
      // Validate read access before the extension spends time collecting classes.
      await readRollEvents();
      return res.json({ ok: true, ticket: collectionTicket(admin.campus, admin.tutor, body.date, body.captureId) });
    }
    if (req.method === 'POST' && body.action === 'import_feedback_schedule') {
      const result = await importRolls(body.capture, body.ticket, admin.campus, admin.tutor);
      return res.json({ ok: true, replayed: result.replayed, date: result.capture.date, sessions: result.capture.sessions.length, bookings: result.capture.sessions.reduce((sum, session) => sum + session.students.length, 0) });
    }
    const date = scheduleDate(req.method === 'GET' ? req.query.date : body.date);
    if (!date) throw new RollsError(400, 'Choose a valid date.');
    const [events, tutors, members] = await Promise.all([readRollEvents(), getActiveTutors(admin.campus), loadMembers()]);
    if (members.warning && !members.members.length) throw new RollsError(503, 'Portal members could not be loaded. Try again before linking.');
    const state = rollState(events, admin.campus, date);
    if (req.method === 'POST') {
      if (body.action !== 'link_identity') throw new RollsError(400, 'Unknown schedule action.');
      if (body.kind !== 'tutor' && body.kind !== 'student') throw new RollsError(400, 'Invalid link type.');
      const scope = body.scope === undefined ? 'remember' : body.scope;
      if (scope !== 'remember' && scope !== 'class') throw new RollsError(400, 'Choose whether to remember the link or use this class only.');
      const source = body.kind === 'tutor' ? nameKey(sourceTutor(String(body.source || ''))) : body.source;
      if (body.kind === 'student' && typeof body.sessionId !== 'string') throw new RollsError(400, 'Choose the student’s class before linking.');
      const exists = state.sessions.some(session => body.kind === 'tutor' ? nameKey(sourceTutor(session.tutorNameRaw)) === source : session.hapanaSessionId === body.sessionId && session.students.some(student => student.id === source));
      if (!exists) throw new RollsError(400, 'This identity is not in the selected saved day.');
      await saveRollLink(admin.campus, admin.tutor, body.kind, source, body.target, tutors, members.members, body.kind === 'student' ? body.sessionId : undefined, scope);
      return res.json({ ok: true });
    }
    const linked = linkedRoster(state, admin.campus, tutors, members.members);
    const instructorNames = [...new Set(state.sessions.map(session => sourceTutor(session.tutorNameRaw)))];
    const students = state.sessions.flatMap(session => session.students.map(student => {
      const match = linked.studentMatch(student, session.hapanaSessionId);
      return { source: student.id, name: student.name, sessionId: session.hapanaSessionId, classLabel: `${minuteTime(session.startMinute)}–${minuteTime(session.endMinute)} · ${session.sessionTitle} · ${sourceTutor(session.tutorNameRaw)}`, target: match.value?.id || '', reason: match.reason, suggestions: match.value ? [] : linked.suggestStudents(student.name) };
    })).sort((a, b) => Number(!!a.target) - Number(!!b.target) || a.name.localeCompare(b.name) || a.classLabel.localeCompare(b.classLabel));
    return res.json({ ok: true, date, lastSync: state.latest?.savedAt || '', mode: state.commits.at(-1)?.capture.mode || '', sessions: state.sessions.length,
      instructors: instructorNames.map(name => { const match = linked.tutorMatch(name); return { source: name, target: match.value || '', reason: match.reason }; }).sort((a, b) => Number(!!a.target) - Number(!!b.target) || a.source.localeCompare(b.source)),
      students,
      tutors: tutors.map(tutor => tutor.tutorName), members: members.members.filter(member => member.active).map(member => ({ id: member.id, name: `${member.firstName} ${member.lastName}`, year: member.years, parentName: member.parentName })) });
  } catch (error) {
    if (!(error instanceof RollsError)) console.error('[feedback-rolls] schedule request failed');
    return res.status(error instanceof RollsError ? error.status : 503).json({ ok: false, error: error instanceof RollsError ? error.message : 'The schedule could not be saved or loaded. Retry the same collection; do not assume it synced.' });
  }
}
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
