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

  try {
    // The inbox is intentionally uncapped. loadFeedbackLogRows already reads the
    // centre's complete feedback log, so truncating the response at 1000 saved no
    // Google Sheets work and made older conversations invisible/unsearchable.
    // Keeping the complete centre archive here also makes the sidebar counts and
    // client-side Gmail-style search accurate across the full history.
    const inbox = await loadFeedbackInbox(admin, { limit: 0 });
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
