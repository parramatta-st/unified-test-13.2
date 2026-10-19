import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadMembers } from '../../lib/members';
import { loadRowsPrivateFirst } from '../../lib/googleSheets';
import { feedbackScheduleSessions, scheduleDate } from '../../lib/feedbackSchedule';
import { linkedRoster, readRollEvents, rollCampusEnabled, rollState } from '../../lib/feedbackRolls';
import { getActiveTutors } from '../../lib/tutorConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required.' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  const date = scheduleDate(req.query.date);
  if (!date) return res.status(400).json({ ok: false, error: 'Choose a valid date.' });
  try {
    if (rollCampusEnabled(auth.campus)) {
      const state = rollState(await readRollEvents(), auth.campus, date);
      if (state.latest) {
        const [members, tutors] = await Promise.all([loadMembers(), getActiveTutors(auth.campus)]);
        const roster = linkedRoster(state, auth.campus, tutors, members.members);
        return res.status(200).json({ ok: true, configured: true, source: 'daily_rolls', date, lastSync: state.latest.savedAt,
          sessions: feedbackScheduleSessions(roster.rows, members.members, auth.campus, auth.tutor, date) });
      }
    }
    const [schedule, members] = await Promise.all([
      loadRowsPrivateFirst({ kind: 'TIMETABLE', sheetName: process.env.TIMETABLE_SHEET_NAME || 'timetable', csvUrls: [process.env.TIMETABLE_CSV_URL || ''] }),
      loadMembers(),
    ]);
    if (schedule.warning && !schedule.rows?.length) return res.status(503).json({ ok: false, error: 'Your schedule is unavailable. Try again or use All students.' });
    return res.status(200).json({ ok: true, configured: schedule.configured, date, tutorName: auth.tutor,
      sessions: feedbackScheduleSessions(schedule.rows || [], members.members, auth.campus, auth.tutor, date) });
  } catch {
    return res.status(503).json({ ok: false, error: 'Your schedule could not be loaded. Try again or use All students.' });
  }
}
