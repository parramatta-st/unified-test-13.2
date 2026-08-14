import type { AuthStatus } from './auth';
import * as inbox from './feedbackInbox';
import { cleanReplyText } from './replyText';

export const norm = inbox.norm;
export const lower = inbox.lower;
export const readValue = inbox.readValue;
export const timestampMs = inbox.timestampMs;

export type FeedbackInboxEvent = inbox.FeedbackInboxEvent;
export type FeedbackInboxConversation = inbox.FeedbackInboxConversation;
export type FeedbackInboxLoad = inbox.FeedbackInboxLoad;

function cleanConversation(item: FeedbackInboxConversation): FeedbackInboxConversation {
  const replies = (item.replies || []).map((reply) => ({
    ...reply,
    messageText: cleanReplyText(reply.messageText),
  }));
  const latestReply = replies.length ? replies[replies.length - 1] : null;

  return {
    ...item,
    replies,
    latestMessagePreview: latestReply
      ? cleanReplyText(latestReply.messageText)
      : item.latestMessagePreview,
  };
}

export async function loadFeedbackInbox(
  auth: Pick<AuthStatus, 'campus'>,
  options: { limit?: number } = {},
): Promise<FeedbackInboxLoad> {
  const loaded = await inbox.loadFeedbackInbox(auth, options);
  return {
    ...loaded,
    items: loaded.items.map(cleanConversation),
  };
}

export async function findFeedbackConversation(
  auth: Pick<AuthStatus, 'campus'>,
  conversationId: string,
) {
  const target = norm(conversationId);
  if (!target) return null;
  const loaded = await loadFeedbackInbox(auth, { limit: 0 });
  return loaded.items.find((item) => item.conversationId === target) || null;
}
