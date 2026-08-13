import type { NextApiRequest, NextApiResponse } from 'next';
import { findRelayConversation, latestParentReplyForConversation, norm, readValue, relaySecretConfigured, relaySecretValid } from '../../lib/replyRelay';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!relaySecretConfigured()) {
    return res.status(503).json({ ok: false, error: 'Reply relay is not configured.' });
  }
  if (!relaySecretValid(req)) {
    return res.status(401).json({ ok: false, error: 'Invalid relay secret.' });
  }

  const relayToken = norm(req.query.token);
  if (!relayToken) return res.status(400).json({ ok: false, error: 'Missing relay token.' });

  try {
    const conversation = await findRelayConversation(relayToken);
    if (!conversation) return res.status(404).json({ ok: false, error: 'Relay conversation not found.' });

    const latestParentReply = await latestParentReplyForConversation(conversation.conversationId);
    const gmailThreadId = latestParentReply ? readValue(latestParentReply, 'gmailThreadId', 'Gmail Thread ID') : '';

    return res.status(200).json({
      ok: true,
      conversationId: conversation.conversationId,
      campusKey: conversation.campusKey,
      campusName: conversation.campusName,
      parentName: conversation.parentName,
      parentEmail: conversation.parentEmail,
      centreInbox: conversation.centreInbox,
      fromName: conversation.fromName,
      fromAddress: conversation.fromAddress,
      subjectLine: conversation.subjectLine,
      gmailThreadId,
    });
  } catch (error: any) {
    console.error('reply-relay-lookup error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Relay lookup failed.' });
  }
}
