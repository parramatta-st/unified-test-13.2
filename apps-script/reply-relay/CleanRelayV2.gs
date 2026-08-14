// CleanRelayV2.gs
// Centre-facing parent notifications should look like ordinary email. This file
// keeps tokens and routing instructions out of the visible subject/body.

function handleParentReplyCleanV2_(cfg, relayToken, conversation, message) {
  const sender = extractAddress_(message.getFrom());
  if (!sender) throw new Error('Parent reply sender address could not be read.');
  if (!conversation.centreInbox) throw new Error('The centre forwarding inbox is missing for this conversation.');

  const expectedParent = String(conversation.parentEmail || '').toLowerCase();
  if (expectedParent && sender !== expectedParent) {
    throw new Error(`Unexpected parent reply sender ${sender}; expected ${expectedParent}.`);
  }

  const body = cleanIncomingBodyReleaseV2_(message.getPlainBody());
  if (!body) throw new Error('The parent reply did not contain any new message text.');

  const relayAddress = `reply+${relayToken}@${cfg.relayDomain}`;
  const thread = message.getThread();
  const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  const attachmentNames = attachments.map((file) => file.getName());

  postRelayEvent_(cfg, {
    eventType: 'parent_reply',
    relayToken,
    conversationId: conversation.conversationId,
    campusKey: conversation.campusKey,
    campusName: conversation.campusName,
    direction: 'parent_to_centre',
    actorRole: 'parent',
    actorName: displayNameFromHeader_(message.getFrom()) || conversation.parentName || '',
    fromAddress: sender,
    toAddress: conversation.centreInbox,
    subjectLine: cleanReplySubjectReleaseV2_(message.getSubject()),
    messageText: body,
    gmailMessageId: message.getId(),
    gmailThreadId: thread.getId(),
    sourceMessageId: message.getId(),
    sendStatus: 'received_and_forwarded',
    attachmentNames,
    timestamp: message.getDate().toISOString(),
  });

  const parentDisplayName = displayNameFromHeader_(message.getFrom())
    || conversation.parentName
    || conversation.parentEmail
    || 'Parent';
  const originalSubject = cleanReplySubjectReleaseV2_(conversation.subjectLine || message.getSubject()) || 'Feedback';

  GmailApp.sendEmail(
    conversation.centreInbox,
    `Re: ${originalSubject}`,
    body,
    gmailSendOptions_(conversation.fromAddress, parentDisplayName, relayAddress, attachments),
  );
}

function cleanReplySubjectReleaseV2_(value) {
  let subject = String(value || '')
    .replace(/\[ST-RELAY:[^\]]+\]\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  let previous = '';
  while (subject && subject !== previous) {
    previous = subject;
    subject = subject.replace(/^(?:re|fw|fwd)\s*:\s*/i, '').trim();
  }
  return subject;
}

function cleanIncomingBodyReleaseV2_(rawBody) {
  let body = String(rawBody || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
  if (!body) return '';

  // Remove the wrapper produced by older relay versions.
  body = body.replace(/^.{1,220}?\s+replied to the feedback email\.\s*\n+/i, '');

  const splitPatterns = [
    /\n\s*-{3,}\s*\n\s*Original subject:/i,
    /\n\s*Reply normally to this email\.[\s\S]*$/i,
    // Gmail often wraps this attribution over two lines before "wrote:".
    /\n\s*On[\s\S]{0,1200}?\bwrote:\s*(?:\n|$)/i,
    /\n\s*-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i,
    /\n\s*From:\s*[^\n]+\n\s*(?:Sent|Date):\s*[^\n]+\n\s*To:\s*[^\n]+\n\s*Subject:\s*[^\n]+/i,
    /\n\s*_{5,}\s*\n/,
  ];

  let cut = -1;
  splitPatterns.forEach((pattern) => {
    const index = body.search(pattern);
    if (index >= 0 && (cut < 0 || index < cut)) cut = index;
  });
  if (cut >= 0) body = body.slice(0, cut).trim();

  return body
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/<https?:\/\/[^>\s]{180,}>/gi, '')
    .replace(/https?:\/\/\S{250,}/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function testCleanRelayV2() {
  const sample = [
    "That's great news, thank you.",
    '',
    'On Thu, 13 Aug 2026 at 11:21 pm, Parramatta Success Tutoring',
    '<parramatta@st-feedback.site> wrote:',
    '> Old feedback text',
  ].join('\n');

  const output = cleanIncomingBodyReleaseV2_(sample);
  const subject = `Re: ${cleanReplySubjectReleaseV2_('[ST-RELAY:parramatta-test] Re: Kevin – English')}`;
  if (output !== "That's great news, thank you." || /ST-RELAY/.test(subject)) {
    throw new Error(`Clean relay self-test failed. output=${output}; subject=${subject}`);
  }
  console.log(JSON.stringify({ ok: true, output, subject }, null, 2));
}
