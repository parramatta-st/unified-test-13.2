import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadMembers } from '../../lib/members';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required' });
  try {
    const { members, source, warning } = await loadMembers();
    const active = members.filter((m) => m.active);
    return res.status(200).json({
      ok: true,
      source,
      warning: warning || '',
      students: active.map((m) => ({
        id: m.id,
        firstName: m.firstName,
        lastName: m.lastName,
        gender: m.gender,
        parentName: m.parentName,
        parentEmail: m.parentEmail,
        years: m.years,
        active: m.active,
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to load contacts' });
  }
}
