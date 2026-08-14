import type { NextApiRequest, NextApiResponse } from 'next';
import { appendFeedbackMessage, loadFeedbackMessageRows } from '../../lib/logs';
import { cleanReplySubject, cleanReplyText } from '../../lib/replyText';
import {
  findRelayConversation,
  lower,
  norm,
  readValue,
  relayHubMode,
  relayHubTargetForToken,
  relaySecretConfigured,
  relaySecretValid,
} from '../../lib/replyRelay';

const ALLOWED_EVENTS = new Set(['parent_reply', 'centre_reply']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!relaySecretConfigured()) {
    return res.status(503).json({ ok: false, error: 'Reply relay is not configured.' });
  }
  if (!relaySecretValid(req)) {
    return res.status(401).json({ ok: false, error: 'Invalid relay secret.' });
  }

  const body = req.body || {};
  const eventType = lower(body.eventType);
  const relayToken = norm(body.relayToken);
  const conversationId = norm(body.conversationId);
  const gmailMessageId = norm(body.gmailMessageId);

  if (!ALLOWED_EVENTS.has(eventType)) {
    return res.status(400).json({ ok: false, error: 'Unsupported relay event.' });
  }
  if (!relayToken || !conversationId || !gmailMessageId) {
    return res.status(400).json({ ok: false, error: 'Missing relayToken, conversationId, or gmailMessageId.' });
  }

  if (relayHubMode()) {
    const target = relayHubTargetForToken(relayToken);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'No relay hub route is configured for this conversation.' });
    }
    try {
      const upstream = await fetch(`${target}/api/reply-relay-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-st-relay-secret': norm(req.headers['x-st-relay-secret']),
        },
        body: JSON.stringify(body),
      });
      const text = await upstream.text();
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
      return res.status(upstream.status).send(text);
    } catch (error: any) {
      console.error('reply-relay hub webhook proxy error', error);
      return res.status(502).json({ ok: false, error: error?.message || 'Relay hub could not reach the centre.' });
    }
  }

  try {
    const conversation = await findRelayConversation(relayToken);
    if (!conversation || conversation.conversationId !== conversationId) {
      return res.status(404).json({ ok: false, error: 'Relay conversation not found.' });
    }

    const existing = await loadFeedbackMessageRows();
    const duplicate = (existing.rows || []).some((row: any) =>
      readValue(row, 'gmailMessageId', 'Gmail Message ID') === gmailMessageId &&
      lower(readValue(row, 'eventType', 'Event Type')) === eventType
    );
    if (duplicate) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const campusKey = norm(body.campusKey) || conversation.campusKey;
    if (conversation.campusKey && campusKey && lower(campusKey) !== lower(conversation.campusKey)) {
      return res.status(400).json({ ok: false, error: 'Campus does not match relay conversation.' });
    }

    const saved = await appendFeedbackMessage({
      timestamp: norm(body.timestamp) || new Date().toISOString(),
      conversationId,
      campusKey: conversation.campusKey || campusKey,
      campusName: conversation.campusName || norm(body.campusName),
      eventType,
      direction: norm(body.direction) || (eventType === 'parent_reply' ? 'parent_to_centre' : 'centre_to_parent'),
      actorRole: norm(body.actorRole) || (eventType === 'parent_reply' ? 'parent' : 'centre'),
      actorName: norm(body.actorName),
      fromAddress: norm(body.fromAddress),
      toAddress: norm(body.toAddress),
      subjectLine: cleanReplySubject(norm(body.subjectLine) || conversation.subjectLine),
      messageText: cleanReplyText(body.messageText),
      gmailMessageId,
      gmailThreadId: norm(body.gmailThreadId),
      sourceMessageId: norm(body.sourceMessageId),
      sendStatus: norm(body.sendStatus) || 'received',
      attachmentNames: Array.isArray(body.attachmentNames) ? body.attachmentNames.join(' | ') : norm(body.attachmentNames),
    });

    if (!saved.saved) {
      return res.status(500).json({ ok: false, error: saved.reason || 'Relay message was not saved.' });
    }

    return res.status(200).json({ ok: true, conversationId });
  } catch (error: any) {
    console.error('reply-relay-webhook error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Relay webhook failed.' });
  }
}
