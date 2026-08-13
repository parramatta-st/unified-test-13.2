import type { NextApiRequest, NextApiResponse } from 'next';
import {
  findRelayConversation,
  latestParentReplyForConversation,
  norm,
  readValue,
  relayHubMode,
  relayHubTargetForToken,
  relaySecretConfigured,
  relaySecretValid,
} from '../../lib/replyRelay';

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

  // The dedicated relay project is intentionally stateless. It reads the
  // campus prefix from the token and proxies to that campus deployment, where
  // the original feedback log and conversation data already live.
  if (relayHubMode()) {
    const target = relayHubTargetForToken(relayToken);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'No relay hub route is configured for this conversation.' });
    }
    try {
      const upstream = await fetch(`${target}/api/reply-relay-lookup?token=${encodeURIComponent(relayToken)}`, {
        method: 'GET',
        headers: { 'x-st-relay-secret': norm(req.headers['x-st-relay-secret']) },
        cache: 'no-store',
      });
      const text = await upstream.text();
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
      return res.status(upstream.status).send(text);
    } catch (error: any) {
      console.error('reply-relay hub lookup proxy error', error);
      return res.status(502).json({ ok: false, error: error?.message || 'Relay hub could not reach the centre.' });
    }
  }

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
