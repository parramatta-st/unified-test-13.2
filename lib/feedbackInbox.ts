import type { AuthStatus } from './auth';
import { loadFeedbackLogRows, loadFeedbackMessageRows } from './logs';
import { defaultCampusKey, defaultCampusName } from './tutorConfig';

export function norm(value: any) { return String(value ?? '').trim(); }
export function lower(value: any) { return norm(value).toLowerCase(); }
function keyName(value: any) { return lower(value).replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, ''); }

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

function campusToken(value: any) {
  return lower(value)
    .replace(/\bsuccess\b/g, ' ')
    .replace(/\btutoring\b/g, ' ')
    .replace(/\bcentre\b/g, ' ')
    .replace(/\bcenter\b/g, ' ')
    .replace(/^st[-_ ]*/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function timestampMs(value: any) {
  const parsed = Date.parse(norm(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function statusValue(row: any) {
  const explicit = lower(readValue(row, 'sendStatus', 'Send Status', 'status', 'Status'));
  if (explicit === 'failed' || explicit === 'error') return 'failed';
  return 'sent';
}

function booleanValue(value: any) {
  return /^(1|true|yes|on)$/i.test(norm(value));
}

function attachmentList(value: any) {
  return norm(value).split('|').map((part) => part.trim()).filter(Boolean);
}

function maxTimestamp(rows: any[]) {
  let winner = '';
  let winnerMs = 0;
  for (const row of rows) {
    const value = readValue(row, 'timestamp', 'Timestamp');
    const ms = timestampMs(value);
    if (ms >= winnerMs) {
      winner = value;
      winnerMs = ms;
    }
  }
  return winner;
}

function visibleMessageEvent(eventType: string) {
  return ['parent_reply', 'centre_reply', 'portal_reply'].includes(lower(eventType));
}

function acknowledgementEvent(eventType: string) {
  return ['read_marker', 'centre_reply', 'portal_reply'].includes(lower(eventType));
}

function eventFromRow(row: any) {
  return {
    timestamp: readValue(row, 'timestamp', 'Timestamp'),
    eventType: readValue(row, 'eventType', 'Event Type'),
    direction: readValue(row, 'direction', 'Direction'),
    actorRole: readValue(row, 'actorRole', 'Actor Role'),
    actorName: readValue(row, 'actorName', 'Actor Name'),
    fromAddress: readValue(row, 'fromAddress', 'From Address'),
    toAddress: readValue(row, 'toAddress', 'To Address'),
    subjectLine: readValue(row, 'subjectLine', 'Subject Line'),
    messageText: readValue(row, 'messageText', 'Message Text'),
    gmailMessageId: readValue(row, 'gmailMessageId', 'Gmail Message ID'),
    gmailThreadId: readValue(row, 'gmailThreadId', 'Gmail Thread ID'),
    sourceMessageId: readValue(row, 'sourceMessageId', 'Source Message ID'),
    sendStatus: readValue(row, 'sendStatus', 'Send Status'),
    attachmentNames: attachmentList(readValue(row, 'attachmentNames', 'Attachment Names')),
  };
}

export type FeedbackInboxEvent = ReturnType<typeof eventFromRow>;

export type FeedbackInboxConversation = {
  id: string;
  timestamp: string;
  conversationId: string;
  campusKey: string;
  campusName: string;
  tutorName: string;
  studentId: string;
  studentName: string;
  studentYear: string;
  parentName: string;
  parentEmail: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  centreInbox: string;
  relayEnabled: boolean;
  relayToken: string;
  subjectLine: string;
  messageText: string;
  sendStatus: string;
  messageId: string;
  feedbackType: string;
  mode: string;
  programLabel: string;
  lessonNumber: string;
  assessmentName: string;
  completionStatus: string;
  year: string;
  subject: string;
  strand: string;
  lesson: string;
  topic: string;
  sourceForm: string;
  replies: FeedbackInboxEvent[];
  replyCount: number;
  latestReplyAt: string;
  latestActivityAt: string;
  latestMessagePreview: string;
  latestMessageRole: string;
  latestGmailThreadId: string;
  latestInboundAt: string;
  latestOutboundAt: string;
  lastReadAt: string;
  unreadCount: number;
  isUnread: boolean;
  canReply: boolean;
};

export type FeedbackInboxLoad = {
  items: FeedbackInboxConversation[];
  total: number;
  unreadTotal: number;
  source: string;
  warning: string;
  messagesWarning: string;
};

export async function loadFeedbackInbox(
  auth: Pick<AuthStatus, 'campus'>,
  options: { limit?: number } = {},
): Promise<FeedbackInboxLoad> {
  const rawLimit = Number(options.limit || 300);
  const limit = Math.min(1000, Math.max(20, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 300));

  const loaded = await loadFeedbackLogRows();
  const messageLoaded = await loadFeedbackMessageRows().catch((error: any) => ({
    rows: [] as any[],
    warning: error?.message || 'Feedback reply history could not be loaded.',
    source: '',
  }));

  const allowedCampusKeys = new Set([
    campusToken(auth.campus),
    campusToken(defaultCampusKey()),
  ].filter(Boolean));
  const allowedCampusNames = new Set([
    campusToken(process.env.NEXT_PUBLIC_CAMPUS_NAME || ''),
    campusToken(defaultCampusName()),
  ].filter(Boolean));

  const scopedRows = (loaded.rows || []).filter((row: any) => {
    const rowCampusKey = readValue(row, 'campusKey', 'Campus Key', 'campus', 'Campus');
    if (rowCampusKey) return allowedCampusKeys.has(campusToken(rowCampusKey));
    const rowCampusName = readValue(row, 'campusName', 'Campus Name', 'centreName', 'Centre Name');
    return !!rowCampusName && allowedCampusNames.has(campusToken(rowCampusName));
  });

  const eventsByConversation = new Map<string, any[]>();
  for (const row of messageLoaded.rows || []) {
    const conversationId = readValue(row, 'conversationId', 'Conversation ID');
    if (!conversationId) continue;
    const current = eventsByConversation.get(conversationId) || [];
    current.push(row);
    eventsByConversation.set(conversationId, current);
  }
  for (const rows of eventsByConversation.values()) {
    rows.sort((a, b) => timestampMs(readValue(a, 'timestamp', 'Timestamp')) - timestampMs(readValue(b, 'timestamp', 'Timestamp')));
  }

  const allItems = scopedRows.map((row: any, index: number) => {
    const timestamp = readValue(row, 'timestamp', 'Timestamp', 'when', 'When');
    const messageId = readValue(row, 'messageId', 'Message ID', 'message_id');
    const conversationId = readValue(row, 'conversationId', 'Conversation ID');
    const campusName = readValue(row, 'campusName', 'Campus Name') || process.env.NEXT_PUBLIC_CAMPUS_NAME || defaultCampusName();
    const studentName = readValue(row, 'studentName', 'Student Name', 'student', 'Student');
    const subjectLine = readValue(row, 'subjectLine', 'Subject Line', 'emailSubject', 'Email Subject');
    const rawEvents = conversationId ? (eventsByConversation.get(conversationId) || []) : [];
    const visibleRows = rawEvents.filter((event) => visibleMessageEvent(readValue(event, 'eventType', 'Event Type')));
    const replyEvents = visibleRows.map(eventFromRow);
    const parentRows = rawEvents.filter((event) => lower(readValue(event, 'eventType', 'Event Type')) === 'parent_reply');
    const acknowledgementRows = rawEvents.filter((event) => acknowledgementEvent(readValue(event, 'eventType', 'Event Type')));
    const readRows = rawEvents.filter((event) => lower(readValue(event, 'eventType', 'Event Type')) === 'read_marker');
    const outboundRows = rawEvents.filter((event) => ['centre_reply', 'portal_reply'].includes(lower(readValue(event, 'eventType', 'Event Type'))));

    const lastAcknowledgedMs = acknowledgementRows.reduce((max, event) => Math.max(max, timestampMs(readValue(event, 'timestamp', 'Timestamp'))), 0);
    const unreadParentRows = parentRows.filter((event) => timestampMs(readValue(event, 'timestamp', 'Timestamp')) > lastAcknowledgedMs);
    const latestVisible = replyEvents.length ? replyEvents[replyEvents.length - 1] : null;
    const latestReplyAt = latestVisible?.timestamp || '';
    const latestActivityAt = timestampMs(latestReplyAt) > timestampMs(timestamp) ? latestReplyAt : timestamp;
    const latestMessagePreview = latestVisible?.messageText || readValue(row, 'messageText', 'Message Text', 'emailBody', 'Email Body', 'feedbackText', 'Feedback Text', 'feedback', 'Feedback', 'text', 'Text');
    const latestMessageRole = latestVisible?.actorRole || 'centre';
    const latestGmailThreadId = [...replyEvents].reverse().find((event) => event.gmailThreadId)?.gmailThreadId || '';

    const item: FeedbackInboxConversation = {
      id: messageId || `${timestamp || 'row'}-${studentName || 'student'}-${index}`,
      timestamp,
      conversationId,
      campusKey: readValue(row, 'campusKey', 'Campus Key', 'campus', 'Campus') || auth.campus,
      campusName,
      tutorName: readValue(row, 'tutorName', 'Tutor Name', 'tutor', 'Tutor'),
      studentId: readValue(row, 'studentId', 'Student ID'),
      studentName,
      studentYear: readValue(row, 'studentYear', 'Student Year', 'year', 'Year'),
      parentName: readValue(row, 'parentName', 'Parent Name'),
      parentEmail: readValue(row, 'parentEmail', 'Parent Email', 'email', 'Email'),
      fromName: readValue(row, 'fromName', 'From Name', 'senderName', 'Sender Name'),
      fromAddress: readValue(row, 'fromAddress', 'From Address', 'senderEmail', 'Sender Email', 'fromEmail', 'From Email'),
      replyTo: readValue(row, 'replyTo', 'Reply To', 'reply-to', 'Reply-To'),
      centreInbox: readValue(row, 'centreInbox', 'Centre Inbox'),
      relayEnabled: booleanValue(readValue(row, 'relayEnabled', 'Relay Enabled')),
      relayToken: readValue(row, 'relayToken', 'Relay Token'),
      subjectLine,
      messageText: readValue(row, 'messageText', 'Message Text', 'emailBody', 'Email Body', 'feedbackText', 'Feedback Text', 'feedback', 'Feedback', 'text', 'Text'),
      sendStatus: statusValue(row),
      messageId,
      feedbackType: readValue(row, 'feedbackType', 'Feedback Type'),
      mode: readValue(row, 'mode', 'Mode'),
      programLabel: readValue(row, 'programLabel', 'Program Label'),
      lessonNumber: readValue(row, 'lessonNumber', 'Lesson Number'),
      assessmentName: readValue(row, 'assessmentName', 'Assessment Name'),
      completionStatus: readValue(row, 'completionStatus', 'Completion Status'),
      year: readValue(row, 'year', 'Year'),
      subject: readValue(row, 'subject', 'Subject'),
      strand: readValue(row, 'strand', 'Strand'),
      lesson: readValue(row, 'lesson', 'Lesson'),
      topic: readValue(row, 'topic', 'Topic'),
      sourceForm: readValue(row, 'sourceForm', 'Source Form'),
      replies: replyEvents,
      replyCount: replyEvents.length,
      latestReplyAt,
      latestActivityAt,
      latestMessagePreview,
      latestMessageRole,
      latestGmailThreadId,
      latestInboundAt: maxTimestamp(parentRows),
      latestOutboundAt: maxTimestamp(outboundRows),
      lastReadAt: maxTimestamp(readRows),
      unreadCount: unreadParentRows.length,
      isUnread: unreadParentRows.length > 0,
      canReply: !!(conversationId && readValue(row, 'parentEmail', 'Parent Email', 'email', 'Email') && readValue(row, 'fromAddress', 'From Address', 'senderEmail', 'Sender Email')),
    };
    return item;
  });

  allItems.sort((a, b) => timestampMs(b.latestActivityAt) - timestampMs(a.latestActivityAt));
  const unreadTotal = allItems.filter((item) => item.isUnread).length;

  return {
    items: allItems.slice(0, limit),
    total: scopedRows.length,
    unreadTotal,
    source: loaded.source || '',
    warning: loaded.warning || '',
    messagesWarning: messageLoaded.warning || '',
  };
}

export async function findFeedbackConversation(
  auth: Pick<AuthStatus, 'campus'>,
  conversationId: string,
) {
  const target = norm(conversationId);
  if (!target) return null;
  const inbox = await loadFeedbackInbox(auth, { limit: 1000 });
  return inbox.items.find((item) => item.conversationId === target) || null;
}
