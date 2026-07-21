import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../lib/adminAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const status = await requireAdmin(req);
  res.status(200).json({ ok: true, authed: status.authed, tutor: status.tutor, campus: status.campus, isAdmin: status.isAdmin });
}
