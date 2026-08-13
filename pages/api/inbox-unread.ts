import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../lib/adminAuth';
import { loadFeedbackInbox } from '../../lib/feedbackInbox';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req);
  if (!admin.authed) return res.status(401).json({ ok: false, error: 'Login required', unreadTotal: 0 });
  if (!admin.isAdmin) return res.status(403).json({ ok: false, error: 'Admin access required', unreadTotal: 0 });

  try {
    const inbox = await loadFeedbackInbox(admin, { limit: 1000 });
    return res.status(200).json({ ok: true, unreadTotal: inbox.unreadTotal });
  } catch (error: any) {
    console.error('inbox-unread error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Could not load unread replies.', unreadTotal: 0 });
  }
}
