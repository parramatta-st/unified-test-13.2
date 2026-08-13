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

export async function findRelayConversation(relayToken: string) {
  const token = norm(relayToken);
  if (!token) return null;

  const loaded = await loadFeedbackLogRows();
  const rows = loaded.rows || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row: any = rows[index];
    if (readValue(row, 'relayToken', 'Relay Token') !== token) continue;
    if (lower(readValue(row, 'sendStatus', 'Send Status')) === 'failed') continue;
    const conversationId = readValue(row, 'conversationId', 'Conversation ID');
    if (!conversationId) continue;
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
      messageId: readValue(row, 'messageId', 'Message ID'),
    };
  }
  return null;
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
