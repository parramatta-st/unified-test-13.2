import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../lib/adminAuth';
import { loadFeedbackMessageRows } from '../../lib/logs';
import { defaultCampusKey, defaultCampusName } from '../../lib/tutorConfig';
import { readValue, timestampMs } from '../../lib/feedbackInboxClean';

function norm(value: any) { return String(value ?? '').trim(); }
function lower(value: any) { return norm(value).toLowerCase(); }

function campusToken(value: any) {
  return lower(value)
    .replace(/\bsuccess\b/g, ' ')
    .replace(/\btutoring\b/g, ' ')
    .replace(/\bcentre\b/g, ' ')
    .replace(/\bcenter\b/g, ' ')
    .replace(/^st[-_ ]*/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

const ACKNOWLEDGEMENT_EVENTS = new Set(['read_marker', 'centre_reply', 'portal_reply']);

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
    // The unread badge only needs feedback_messages. Loading the full feedback
    // archive here doubled Sheets reads because the Inbox page also loads the
    // complete conversation list. Keep this endpoint intentionally lightweight.
    const loaded = await loadFeedbackMessageRows();
    if (loaded.warning) {
      // Never turn a temporary Sheets/quota error into a fake "Unread 0". The
      // client keeps its last known count and retries on the next poll instead.
      return res.status(503).json({
        ok: false,
        error: `Unread status could not load reply history: ${loaded.warning}`,
      });
    }

    const allowedCampusKeys = new Set([
      campusToken(admin.campus),
      campusToken(defaultCampusKey()),
    ].filter(Boolean));
    const allowedCampusNames = new Set([
      campusToken(process.env.NEXT_PUBLIC_CAMPUS_NAME || ''),
      campusToken(defaultCampusName()),
    ].filter(Boolean));

    const stateByConversation = new Map<string, { latestParentMs: number; latestAcknowledgedMs: number }>();

    for (const row of loaded.rows || []) {
      const rowCampusKey = readValue(row, 'campusKey', 'Campus Key', 'campus', 'Campus');
      const rowCampusName = readValue(row, 'campusName', 'Campus Name', 'centreName', 'Centre Name');
      const campusAllowed = rowCampusKey
        ? allowedCampusKeys.has(campusToken(rowCampusKey))
        : !!rowCampusName && allowedCampusNames.has(campusToken(rowCampusName));
      if (!campusAllowed) continue;

      const conversationId = readValue(row, 'conversationId', 'Conversation ID');
      if (!conversationId) continue;

      const eventType = lower(readValue(row, 'eventType', 'Event Type'));
      const eventMs = timestampMs(readValue(row, 'timestamp', 'Timestamp'));
      if (!eventMs) continue;

      const state = stateByConversation.get(conversationId) || { latestParentMs: 0, latestAcknowledgedMs: 0 };
      if (eventType === 'parent_reply') state.latestParentMs = Math.max(state.latestParentMs, eventMs);
      if (ACKNOWLEDGEMENT_EVENTS.has(eventType)) {
        state.latestAcknowledgedMs = Math.max(state.latestAcknowledgedMs, eventMs);
      }
      stateByConversation.set(conversationId, state);
    }

    let unreadTotal = 0;
    for (const state of stateByConversation.values()) {
      if (state.latestParentMs > state.latestAcknowledgedMs) unreadTotal += 1;
    }

    return res.status(200).json({ ok: true, unreadTotal });
  } catch (error: any) {
    console.error('inbox-unread error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Could not load unread replies.' });
  }
}
