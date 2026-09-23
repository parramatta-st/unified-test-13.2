import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../lib/adminAuth';
import { changeDoorLink, doorError, doorHeaders, loadDoorLinks, requireDoorPost } from '../../lib/doorClock';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  doorHeaders(res);
  const admin = await requireAdmin(req);
  if (!admin.authed) return res.status(401).json({ ok: false, error: 'Login required.' });
  if (!admin.isAdmin || !admin.campus) return res.status(403).json({ ok: false, error: 'Admin access required.' });
  try {
    if (req.method === 'GET') {
      const link = (await loadDoorLinks()).find(item => item.campusKey === admin.campus.toLowerCase());
      return res.status(200).json({ ok: true, campus: admin.campus, enabled: !!link?.enabled, linkId: link?.linkId || '', updatedAt: link?.createdAt || '', updatedBy: link?.createdBy || '' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'Method not allowed.' }); }
    requireDoorPost(req);
    const action = req.body?.action;
    if (!['create', 'rotate', 'disable'].includes(action)) return res.status(400).json({ ok: false, error: 'Unknown action.' });
    const result = await changeDoorLink(admin.campus, admin.tutor, action);
    // Raw token is shown once to the administrator; only its hash is stored.
    return res.status(200).json({ ok: true, enabled: !!result.link?.enabled, path: result.token ? `/clock/tap#key=${result.token}` : '' });
  } catch (error) { return doorError(res, error); }
}
export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };
