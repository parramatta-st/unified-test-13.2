import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import nodemailer from 'nodemailer';
import { requireAdmin } from '../../lib/adminAuth';
import { findFeedbackConversation, norm, readValue } from '../../lib/feedbackInboxClean';
import { appendFeedbackMessage, loadFeedbackMessageRows } from '../../lib/logs';
import { cleanReplySubject } from '../../lib/replyText';

function headerSafe(value: any) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function replySubject(value: string) {
  return `Re: ${cleanReplySubject(headerSafe(value || 'Feedback')) || 'Feedback'}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
  const replyText = String(req.body?.messageText || '').trim();
  const signature = String(req.body?.signature || '').trim();
  const includeSignature = req.body?.includeSignature !== false;
  const actorName = headerSafe(req.body?.actorName || admin.tutor || 'Centre admin');
  const clientRequestId = headerSafe(req.body?.clientRequestId || crypto.randomUUID());

  if (!conversationId) return res.status(400).json({ ok: false, error: 'Missing conversationId' });
  if (!replyText) return res.status(400).json({ ok: false, error: 'Write a reply before sending.' });
  if (replyText.length > 20000) return res.status(400).json({ ok: false, error: 'Reply is too long.' });
  if (signature.length > 4000) return res.status(400).json({ ok: false, error: 'Signature is too long.' });

  try {
    const conversation = await findFeedbackConversation(admin, conversationId);
    if (!conversation) return res.status(404).json({ ok: false, error: 'Conversation not found for this centre.' });
    if (!conversation.canReply) return res.status(400).json({ ok: false, error: 'This conversation does not have enough email information to reply.' });

    const sourceMessageId = `portal:${clientRequestId}`;
    const existing = await loadFeedbackMessageRows().catch(() => ({ rows: [] as any[] }));
    const duplicate = (existing.rows || []).some((row: any) =>
      readValue(row, 'conversationId', 'Conversation ID') === conversationId &&
      readValue(row, 'sourceMessageId', 'Source Message ID') === sourceMessageId
    );
    if (duplicate) return res.status(200).json({ ok: true, duplicate: true, conversationId });

    const user = headerSafe(process.env.MAIL_USER);
    const pass = process.env.MAIL_PASS || '';
    const fromAddress = headerSafe(conversation.fromAddress || process.env.MAIL_FROM || user);
    const fromName = headerSafe(conversation.fromName || conversation.campusName || 'Success Tutoring');
    const toAddress = headerSafe(conversation.parentEmail);
    const replyTo = headerSafe(conversation.replyTo || fromAddress);
    const subject = replySubject(conversation.subjectLine);
    const finalText = [replyText, includeSignature && signature ? signature : ''].filter(Boolean).join('\n\n');

    if (!user || !pass) return res.status(500).json({ ok: false, error: 'MAIL_USER/PASS not configured.' });
    if (!fromAddress || !toAddress) return res.status(400).json({ ok: false, error: 'Sender or parent email is missing.' });

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    const safeFromName = fromName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const mail: any = {
      from: `"${safeFromName}" <${fromAddress}>`,
      to: toAddress,
      replyTo,
      subject,
      text: finalText,
      html: escapeHtml(finalText).replace(/\n/g, '<br>'),
      headers: {
        'X-ST-Conversation-ID': conversationId,
        'X-ST-Portal-Reply': '1',
        'X-ST-Campus-Key': conversation.campusKey,
      },
    };

    if (conversation.messageId) {
      mail.inReplyTo = conversation.messageId;
      mail.references = conversation.messageId;
    }

    const info = await transporter.sendMail(mail);
    const timestamp = new Date().toISOString();
    const saved = await appendFeedbackMessage({
      timestamp,
      conversationId,
      campusKey: conversation.campusKey,
      campusName: conversation.campusName,
      eventType: 'portal_reply',
      direction: 'centre_to_parent',
      actorRole: 'centre',
      actorName,
      fromAddress,
      toAddress,
      subjectLine: subject,
      messageText: finalText,
      gmailMessageId: info?.messageId || sourceMessageId,
      gmailThreadId: conversation.latestGmailThreadId,
      sourceMessageId,
      sendStatus: 'sent_from_portal',
      attachmentNames: '',
    });

    if (!saved.saved) {
      console.error('Portal reply sent but could not be logged', { conversationId, reason: saved.reason });
      return res.status(200).json({
        ok: true,
        warning: 'The email was sent, but the portal could not save the conversation record.',
        conversationId,
        messageId: info?.messageId || '',
        timestamp,
      });
    }

    return res.status(200).json({
      ok: true,
      conversationId,
      messageId: info?.messageId || '',
      timestamp,
    });
  } catch (error: any) {
    console.error('inbox-reply error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Reply could not be sent.' });
  }
}
