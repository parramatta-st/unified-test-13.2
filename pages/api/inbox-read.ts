import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../lib/adminAuth';
import { findFeedbackConversation, norm } from '../../lib/feedbackInboxClean';
import { appendFeedbackMessage } from '../../lib/logs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req);
  if (!admin.authed) return res.status(401).json({ ok: false, error: 'Login required' });
  if (!admin.isAdmin) return res.status(403).json({ ok: false, error: 'Admin access required' });

  const conversationId = norm(req.body?.conversationId);
  if (!conversationId) return res.status(400).json({ ok: false, error: 'Missing conversationId' });

  try {
    const conversation = await findFeedbackConversation(admin, conversationId);
    if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found for this centre.' });
    if (!conversation.isUnread) return res.status(200).json({ ok: true, alreadyRead: true, conversationId });

    const timestamp = new Date().toISOString();
    const markerId = `read-${crypto.randomUUID()}`;
    const saved = await appendFeedbackMessage({
      timestamp,
      conversationId,
      campusKey: conversation.campusKey,
      campusName: conversation.campusName,
      eventType: 'read_marker',
      direction: 'admin_action',
      actorRole: 'admin',
      actorName: admin.tutor,
      fromAddress: '',
      toAddress: '',
      subjectLine: conversation.subjectLine,
      messageText: '',
      gmailMessageId: markerId,
      gmailThreadId: conversation.latestGmailThreadId,
      sourceMessageId: markerId,
      sendStatus: 'read',
      attachmentNames: '',
    });

    if (!saved.saved) {
      return res.status(500).json({ ok: false, error: saved.reason || 'Read status could not be saved.' });
    }

    return res.status(200).json({ ok: true, conversationId, readAt: timestamp });
  } catch (error: any) {
    console.error('inbox-read error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Could not mark the conversation as read.' });
  }
}
