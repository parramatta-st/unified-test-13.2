import crypto from 'crypto';
import type { NextApiRequest } from 'next';
import { loadFeedbackLogRows, loadFeedbackMessageRows } from './logs';

export function norm(value: any) { return String(value ?? '').trim(); }
export function lower(value: any) { return norm(value).toLowerCase(); }

function keyName(value: any) {
  return lower(value).replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, '');
}

export function readValue(row: any, ...keys: string[]) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && norm(row[key]) !== '') return norm(row[key]);
  }
  const wanted = new Set(keys.map(keyName));
  for (const [rawKey, value] of Object.entries(row || {})) {
    if (wanted.has(keyName(rawKey)) && value !== undefined && value !== null && norm(value) !== '') return norm(value);
  }
  return '';
}

function secureEqual(a: string, b: string) {
  const left = Buffer.from(a || '', 'utf8');
  const right = Buffer.from(b || '', 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function relaySecretConfigured() {
  return !!norm(process.env.REPLY_RELAY_SECRET);
}

export function relaySecretValid(req: NextApiRequest) {
  const configured = norm(process.env.REPLY_RELAY_SECRET);
  const supplied = norm(req.headers['x-st-relay-secret']);
  return !!configured && secureEqual(configured, supplied);
}

// Keep the route prefix compact so the complete local-part remains comfortably
// below the RFC email-address limit. Future centres only need a stable campusKey.
export function relayRouteKey(value: any) {
  return lower(value).replace(/[^a-z0-9]+/g, '').slice(0, 20);
}

// New relay tokens use: <campus-route>-<32 lowercase hex chars>.
// The existing Workspace routing regex already accepts this shape.
export function relayRouteKeyFromToken(relayToken: string) {
  const token = lower(relayToken);
  const match = token.match(/^([a-z0-9]{1,20})-([a-f0-9]{32})$/);
  return match ? match[1] : '';
}

type RelayHubRoutes = Record<string, string>;

// These are public Vercel production URLs, not secrets. Keeping the current
// centre routes in code means a central-relay deployment cannot silently stop
// routing replies just because a shared Vercel env link was omitted. The env
// map still overrides or extends these defaults for future centres.
const BUILT_IN_RELAY_HUB_ROUTES: RelayHubRoutes = {
  parramatta: 'https://unified-test-13-2.vercel.app',
  stp: 'https://unified-test-13-2.vercel.app',
  greenvalley: 'https://stgv-unified-site.vercel.app',
  stgv: 'https://stgv-unified-site.vercel.app',
  mtgravatteast: 'https://stmg-unified-site.vercel.app',
  stmg: 'https://stmg-unified-site.vercel.app',
  bankstown: 'https://stbankstown-unified-site.vercel.app',
  ryde: 'https://stryde-unified-site.vercel.app',
};

function isCentralRelayProject() {
  const productionHost = lower(process.env.VERCEL_PROJECT_PRODUCTION_URL || '');
  const deploymentHost = lower(process.env.VERCEL_URL || '');
  return productionHost.includes('st-feedback-relay') || deploymentHost.includes('st-feedback-relay');
}

export function relayHubRoutes(): RelayHubRoutes {
  // This repository is deployed to every centre as well as the central relay.
  // Never let a centre deployment become a relay hub merely because a shared
  // REPLY_RELAY_HUB_ROUTES variable was linked too broadly in Vercel.
  if (!isCentralRelayProject()) return {};

  const out: RelayHubRoutes = { ...BUILT_IN_RELAY_HUB_ROUTES };
  const raw = norm(process.env.REPLY_RELAY_HUB_ROUTES);
  if (!raw) return out;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
    for (const [key, value] of Object.entries(parsed)) {
      const route = relayRouteKey(key);
      const url = norm(value).replace(/\/+$/, '');
      if (!route || !/^https:\/\//i.test(url)) continue;
      out[route] = url;
    }
    return out;
  } catch {
    // A malformed optional override must not take the whole reply relay down.
    return out;
  }
}

export function relayHubMode() {
  return Object.keys(relayHubRoutes()).length > 0;
}

export function relayHubTargetForRoute(routeKey: string) {
  const route = relayRouteKey(routeKey);
  if (!route) return '';
  return relayHubRoutes()[route] || '';
}

export function relayHubTargetForToken(relayToken: string) {
  const route = relayRouteKeyFromToken(relayToken);
  if (!route) return '';
  return relayHubTargetForRoute(route);
}

function buildConversation(row: any, relayToken: string) {
  const token = norm(relayToken);
  const conversationId = readValue(row, 'conversationId', 'Conversation ID');
  if (!token || !conversationId) return null;
  return {
    row,
    conversationId,
    relayToken: token,
    campusKey: readValue(row, 'campusKey', 'Campus Key', 'campus', 'Campus'),
    campusName: readValue(row, 'campusName', 'Campus Name'),
    parentName: readValue(row, 'parentName', 'Parent Name'),
    parentEmail: readValue(row, 'parentEmail', 'Parent Email'),
    centreInbox: readValue(row, 'centreInbox', 'Centre Inbox', 'REPLY_TO', 'Reply To'),
    fromName: readValue(row, 'fromName', 'From Name'),
    fromAddress: readValue(row, 'fromAddress', 'From Address'),
    subjectLine: readValue(row, 'subjectLine', 'Subject Line'),
    messageText: readValue(row, 'messageText', 'Message Text', 'emailBody', 'Email Body', 'feedbackText', 'Feedback Text'),
    messageId: readValue(row, 'messageId', 'Message ID'),
  };
}

export async function findRelayConversation(relayToken: string) {
  const token = norm(relayToken);
  if (!token) return null;

  const loaded = await loadFeedbackLogRows();
  const rows = loaded.rows || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row: any = rows[index];
    if (readValue(row, 'relayToken', 'Relay Token') !== token) continue;
    if (lower(readValue(row, 'sendStatus', 'Send Status')) === 'failed') continue;
    const conversation = buildConversation(row, token);
    if (conversation) return conversation;
  }
  return null;
}

function normaliseReplySubject(value: any) {
  let subject = lower(value)
    .replace(/\[st-relay:[^\]]+\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  let previous = '';
  while (subject && subject !== previous) {
    previous = subject;
    subject = subject.replace(/^(?:re|fw|fwd)\s*:\s*/i, '').trim();
  }
  return subject;
}

// Fallback for mail systems that ignore Reply-To and send a centre response to
// the visible @st-feedback.site alias instead of reply+<token>@st-feedback.site.
// We only accept an exact centre-inbox + normalised-subject match, and only when
// it identifies one unique relay conversation. Ambiguous matches are rejected.
export async function findRelayConversationByCentreReply(sender: string, subject: string) {
  const senderEmail = lower(sender);
  const subjectKey = normaliseReplySubject(subject);
  if (!senderEmail || !subjectKey) return { conversation: null as any, ambiguous: false };

  const loaded = await loadFeedbackLogRows();
  const rows = loaded.rows || [];
  const matches: any[] = [];
  const seen = new Set<string>();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row: any = rows[index];
    if (lower(readValue(row, 'sendStatus', 'Send Status')) === 'failed') continue;
    const relayToken = readValue(row, 'relayToken', 'Relay Token');
    if (!relayToken) continue;
    const centreInbox = lower(readValue(row, 'centreInbox', 'Centre Inbox', 'REPLY_TO', 'Reply To'));
    if (!centreInbox || centreInbox !== senderEmail) continue;
    if (normaliseReplySubject(readValue(row, 'subjectLine', 'Subject Line')) !== subjectKey) continue;

    const conversation = buildConversation(row, relayToken);
    if (!conversation || seen.has(conversation.conversationId)) continue;
    seen.add(conversation.conversationId);
    matches.push(conversation);
    if (matches.length > 1) break;
  }

  if (matches.length !== 1) return { conversation: null as any, ambiguous: matches.length > 1 };
  return { conversation: matches[0], ambiguous: false };
}

export async function relayMessagesForConversation(conversationId: string) {
  const target = norm(conversationId);
  if (!target) return [] as any[];
  const loaded = await loadFeedbackMessageRows();
  return (loaded.rows || []).filter((row: any) => readValue(row, 'conversationId', 'Conversation ID') === target);
}

export async function latestParentReplyForConversation(conversationId: string) {
  const rows = await relayMessagesForConversation(conversationId);
  const parentReplies = rows.filter((row: any) => lower(readValue(row, 'eventType', 'Event Type')) === 'parent_reply');
  parentReplies.sort((a: any, b: any) => {
    const aMs = Date.parse(readValue(a, 'timestamp', 'Timestamp')) || 0;
    const bMs = Date.parse(readValue(b, 'timestamp', 'Timestamp')) || 0;
    return bMs - aMs;
  });
  return parentReplies[0] || null;
}
