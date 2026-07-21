import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { appendPrintLog } from '../../lib/logs';
import { defaultCampusKey } from '../../lib/tutorConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required' });

  try {
    const body = req.body || {};
    const payload = { ...body, tutor: body.tutor || auth.tutor || '', campusKey: auth.campus || body.campusKey || defaultCampusKey() };
    const privateLog = await appendPrintLog(payload).catch((err) => ({ saved: false, error: err?.message || 'private logging failed' }));
    const webhook = process.env.PRINT_LOG_WEBHOOK_URL;
    if (!privateLog.saved && webhook) {
      await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return res.status(200).json({ ok: true, logged: 'webhook' });
    }
    if (!privateLog.saved && !webhook) return res.status(500).json({ ok: false, error: 'Private print log sheet or PRINT_LOG_WEBHOOK_URL is not configured' });
    return res.status(200).json({ ok: true, logged: 'private-sheet' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'log failed' });
  }
}
