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
  if (!admin.authed) return res.status(401).json({ ok: false, error: 'Login required' });
  if (!admin.isAdmin) return res.status(403).json({ ok: false, error: 'Admin access required' });

  const rawLimit = Number(req.query.limit || 300);
  const limit = Math.min(1000, Math.max(20, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 300));

  try {
    const inbox = await loadFeedbackInbox(admin, { limit });
    if (inbox.warning && !inbox.total) {
      return res.status(500).json({ ok: false, error: `Inbox could not load the feedback log: ${inbox.warning}` });
    }

    return res.status(200).json({
      ok: true,
      items: inbox.items,
      total: inbox.total,
      unreadTotal: inbox.unreadTotal,
      campus: admin.campus,
      tutor: admin.tutor,
      source: inbox.source,
      warning: [inbox.warning, inbox.messagesWarning].filter(Boolean).join(' '),
    });
  } catch (error: any) {
    console.error('sent-feedback error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Failed to load the feedback inbox.' });
  }
}
