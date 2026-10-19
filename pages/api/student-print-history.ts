import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadPrintLogRows } from '../../lib/logs';
import { studentPrintBatches } from '../../lib/studentPrintHistory';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).end(); }
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok:false, error:'Login required' });
  const studentId = typeof req.query.studentId === 'string' ? req.query.studentId.trim() : '';
  const studentName = typeof req.query.studentName === 'string' ? req.query.studentName.trim() : '';
  if (!studentId && !studentName) return res.status(400).json({ ok:false, error:'Choose a student.' });
  try {
    const loaded = await loadPrintLogRows();
    if (!loaded.configured) return res.status(200).json({ ok:true, prints:[], warning:'Print history is not configured for this centre.' });
    return res.status(200).json({ ok:true, prints:studentPrintBatches(loaded.rows || [],auth.campus,studentId,studentName), warning:(loaded as any).warning || '' });
  } catch {
    return res.status(503).json({ ok:false, error:'Print history is temporarily unavailable. Try again.' });
  }
}
