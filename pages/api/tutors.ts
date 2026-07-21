import type { NextApiRequest, NextApiResponse } from 'next';
import { loadTutorConfigWithMeta, uniqueCampuses } from '../../lib/tutorConfig';

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const meta = await loadTutorConfigWithMeta();
    const tutors = meta.tutors;
    const active = tutors.filter((t) => t.active);
    const campusKeys = unique(tutors.map((t) => t.campusKey));
    const activeCampusKeys = unique(active.map((t) => t.campusKey));

    const debug = {
      source: meta.source,
      warning: meta.warning,
      sheetName: meta.sheetName,
      spreadsheetId: meta.spreadsheetId,
      configured: meta.configured,
      privateConfigured: meta.privateConfigured,
      totalTutors: tutors.length,
      activeTutors: active.length,
      campusKeys,
      activeCampusKeys,
    };

    return res.status(200).json({
      ok: true,
      warning: meta.warning,
      debug,
      campuses: uniqueCampuses(active),
      // Names only. This endpoint is unauthenticated (the login page needs it
      // to fill the tutor dropdown), so it must not reveal who holds the
      // admin role — that would hand attackers a target list.
      tutors: active.map((t) => ({
        campusKey: t.campusKey,
        campusName: t.campusName,
        tutorName: t.tutorName,
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to load tutors' });
  }
}
