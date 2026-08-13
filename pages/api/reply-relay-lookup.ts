import type { NextApiRequest, NextApiResponse } from 'next';
import {
  findRelayConversation,
  findRelayConversationByCentreReply,
  latestParentReplyForConversation,
  norm,
  readValue,
  relayHubMode,
  relayHubTargetForRoute,
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
  const fallbackRoute = norm(req.query.route);
  const fallbackSender = norm(req.query.sender);
  const fallbackSubject = norm(req.query.subject);
  const fallbackLookup = !relayToken && !!(fallbackRoute && fallbackSender && fallbackSubject);

  if (!relayToken && !fallbackLookup) {
    return res.status(400).json({ ok: false, error: 'Missing relay token or fallback centre-reply lookup fields.' });
  }

  // The dedicated relay project is intentionally stateless. Normal lookups
  // route by the campus prefix encoded in the relay token. Fallback lookups
  // route by an explicit campus route derived from the incoming centre email.
  if (relayHubMode()) {
    const target = relayToken
      ? relayHubTargetForToken(relayToken)
      : relayHubTargetForRoute(fallbackRoute);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'No relay hub route is configured for this conversation.' });
    }
    try {
      const params = new URLSearchParams();
      if (relayToken) {
        params.set('token', relayToken);
      } else {
        // Preserve the route as well as sender + subject when proxying the
        // fallback lookup. The centre deployment validates all three fields
        // before it performs the strict centre-inbox + subject match.
        params.set('route', fallbackRoute);
        params.set('sender', fallbackSender);
        params.set('subject', fallbackSubject);
      }
      const upstream = await fetch(`${target}/api/reply-relay-lookup?${params.toString()}`, {
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
    let conversation: any = null;
    if (relayToken) {
      conversation = await findRelayConversation(relayToken);
    } else {
      const fallback = await findRelayConversationByCentreReply(fallbackSender, fallbackSubject);
      if (fallback.ambiguous) {
        return res.status(409).json({ ok: false, error: 'Centre reply matches more than one relay conversation.' });
      }
      conversation = fallback.conversation;
    }

    if (!conversation) return res.status(404).json({ ok: false, error: 'Relay conversation not found.' });

    const latestParentReply = await latestParentReplyForConversation(conversation.conversationId);
    const gmailThreadId = latestParentReply ? readValue(latestParentReply, 'gmailThreadId', 'Gmail Thread ID') : '';

    return res.status(200).json({
      ok: true,
      relayToken: conversation.relayToken,
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
