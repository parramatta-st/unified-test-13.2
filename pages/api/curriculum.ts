import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadRowsPrivateFirst, sheetNames } from '../../lib/googleSheets';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required' });
  try {
    const loaded = await loadRowsPrivateFirst({
      kind: 'CURRICULUM',
      sheetName: sheetNames.curriculum(),
      csvUrls: [process.env.CURRICULUM_CSV_URL || '', process.env.NEXT_PUBLIC_CURRICULUM_CSV_URL || ''],
    });
    return res.status(200).json({ ok: true, rows: loaded.rows || [], source: loaded.source, warning: (loaded as any).warning || '' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to load curriculum' });
  }
}
