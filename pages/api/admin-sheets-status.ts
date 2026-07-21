import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../lib/adminAuth';
import { testPrivateSheetAccess } from '../../lib/googleSheets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const admin = await requireAdmin(req);
  if (!admin.isAdmin) return res.status(403).json({ ok: false, error: 'Admin access required' });
  const status = await testPrivateSheetAccess();
  if (!status.ok) return res.status(500).json({ ...status, ok: false, error: (status as any).error || 'Private Google Sheets connection failed' });
  return res.status(200).json(status);
}
