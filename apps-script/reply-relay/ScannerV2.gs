// ScannerV2.gs
// Add this file to the same Apps Script project as Code.gs.
// It broadens the Gmail scan so centre replies are found even when the centre
// mail system ignores Reply-To and sends to the visible @st-feedback.site alias.

function runReplyRelayV2() {
  const cfg = relayConfig_();
  const processedList = loadProcessedIds_();
  const processed = new Set(processedList);

  const queries = [
    `in:inbox newer_than:${cfg.lookbackDays}d to:(${cfg.relayDomain})`,
    `in:inbox newer_than:${cfg.lookbackDays}d from:successtutoring.com.au`,
    `in:inbox newer_than:${cfg.lookbackDays}d from:successtutoring.com`,
  ];

  const threadsById = new Map();
  queries.forEach((query) => {
    GmailApp.search(query, 0, cfg.maxThreads).forEach((thread) => {
      threadsById.set(thread.getId(), thread);
    });
  });

  const messagesById = new Map();
  Array.from(threadsById.values()).forEach((thread) => {
    thread.getMessages().forEach((message) => {
      messagesById.set(message.getId(), message);
    });
  });

  const messages = Array.from(messagesById.values());
  messages.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());

  console.log(`Reply relay V2 scan: ${threadsById.size} threads, ${messages.length} messages.`);

  let changed = false;
  messages.forEach((message) => {
    const messageId = message.getId();
    if (processed.has(messageId)) return;

    const sender = extractAddress_(message.getFrom());
    let relayToken = relayTokenFromMessage_(message, cfg.relayDomain);
    let conversation = null;

    try {
      if (relayToken) {
        conversation = lookupConversation_(cfg, relayToken);
      } else {
        if (!isPotentialCentreSender_(sender)) return;

        const route = relayRouteFromMessage_(message, cfg.relayDomain) || relayRouteFromSender_(sender);
        if (!route) {
          console.log(`Centre-looking message ${messageId} had no usable route; sender=${sender}.`);
          return;
        }

        console.log(`Trying centre fallback for ${messageId}; sender=${sender}; route=${route}; subject=${message.getSubject()}`);
        conversation = lookupCentreConversationFallback_(cfg, route, sender, message.getSubject());
        relayToken = String(conversation.relayToken || '');
        if (!relayToken) throw new Error('Fallback relay lookup did not return a relay token.');
        console.log(`Recovered centre reply ${messageId} using route ${route}.`);
      }

      const centreInbox = String(conversation.centreInbox || '').toLowerCase();
      const fromAlias = String(conversation.fromAddress || '').toLowerCase();

      if (sender && sender === fromAlias) {
        rememberProcessed_(processedList, processed, messageId);
        changed = true;
        return;
      }

      if (centreInbox && sender === centreInbox) {
        console.log(`Relaying centre reply ${messageId} to ${conversation.parentEmail}.`);
        handleCentreReplyV2_(cfg, relayToken, conversation, message);
      } else {
        console.log(`Relaying parent reply ${messageId} to ${conversation.centreInbox}.`);
        handleParentReply_(cfg, relayToken, conversation, message);
      }

      rememberProcessed_(processedList, processed, messageId);
      changed = true;
    } catch (error) {
      console.error(`Reply relay V2 failed for Gmail message ${messageId}: ${error && error.stack ? error.stack : error}`);
    }
  });

  if (changed) saveProcessedIds_(processedList);
}

// Reply to the actual parent message, not GmailThread.reply(). GmailThread.reply()
// targets the sender of the last message in the thread, which can be the centre
// after Google Workspace routing has placed the centre reply into the thread.
function handleCentreReplyV2_(cfg, relayToken, conversation, message) {
  const sender = extractAddress_(message.getFrom());
  const expected = String(conversation.centreInbox || '').toLowerCase();
  if (!expected || sender !== expected) {
    throw new Error(`Centre reply sender ${sender || '(unknown)'} does not match ${expected || '(missing centre inbox)'}.`);
  }

  const delivered = deliverCentreReplyToParentV2_(cfg, relayToken, conversation, message);

  postRelayEvent_(cfg, {
    eventType: 'centre_reply',
    relayToken,
    conversationId: conversation.conversationId,
    campusKey: conversation.campusKey,
    campusName: conversation.campusName,
    direction: 'centre_to_parent',
    actorRole: 'centre',
    actorName: conversation.fromName || conversation.campusName || displayNameFromHeader_(message.getFrom()),
    fromAddress: conversation.fromAddress,
    toAddress: conversation.parentEmail,
    subjectLine: conversation.subjectLine || message.getSubject(),
    messageText: delivered.body,
    gmailMessageId: delivered.sentMessage ? delivered.sentMessage.getId() : message.getId(),
    gmailThreadId: delivered.gmailThreadId,
    sourceMessageId: message.getId(),
    sendStatus: 'sent_to_parent',
    attachmentNames: delivered.attachmentNames,
    timestamp: new Date().toISOString(),
  });
}

function deliverCentreReplyToParentV2_(cfg, relayToken, conversation, message) {
  const parentMessage = findParentRelayMessageV2_(conversation);
  const parentAddress = extractAddress_(parentMessage.getFrom());
  const expectedParent = String(conversation.parentEmail || '').toLowerCase();
  if (!expectedParent || parentAddress !== expectedParent) {
    throw new Error(`Parent message sender ${parentAddress || '(unknown)'} does not match ${expectedParent || '(missing parent email)'}.`);
  }

  const relayAddress = `reply+${relayToken}@${cfg.relayDomain}`;
  const body = cleanIncomingBody_(message.getPlainBody());
  if (!body) throw new Error('The centre reply did not contain any new message text.');

  const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  const attachmentNames = attachments.map((file) => file.getName());

  // GmailMessage.reply() replies to the sender of this specific parent message,
  // so delivery cannot accidentally loop back to the centre.
  parentMessage.reply(
    body,
    gmailSendOptions_(conversation.fromAddress, conversation.fromName || conversation.campusName || 'Success Tutoring', relayAddress, attachments),
  );

  const gmailThreadId = parentMessage.getThread().getId();
  const refreshed = GmailApp.getThreadById(gmailThreadId);
  const sentMessages = refreshed ? refreshed.getMessages() : [];
  const sentMessage = sentMessages.length ? sentMessages[sentMessages.length - 1] : null;

  return { body, attachmentNames, sentMessage, gmailThreadId };
}

function findParentRelayMessageV2_(conversation) {
  if (!conversation.gmailThreadId) {
    throw new Error('No parent Gmail thread is recorded for this relay conversation.');
  }

  const thread = GmailApp.getThreadById(conversation.gmailThreadId);
  if (!thread) throw new Error('The original parent Gmail thread could not be found.');

  const expectedParent = String(conversation.parentEmail || '').toLowerCase();
  const messages = thread.getMessages();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (extractAddress_(candidate.getFrom()) === expectedParent) return candidate;
  }

  throw new Error(`No Gmail message from parent ${expectedParent || '(missing email)'} was found in the recorded thread.`);
}

// One-time recovery helper for a centre reply that the old implementation
// already logged but accidentally replied back to the centre. It deliberately
// sends only; it does not post another portal event, so the archive is not
// duplicated. Run this once immediately after upgrading ScannerV2 if needed.
function retryLatestCentreReplyDeliveryV2() {
  const cfg = relayConfig_();
  const queries = [
    `in:inbox newer_than:${cfg.lookbackDays}d from:successtutoring.com.au`,
    `in:inbox newer_than:${cfg.lookbackDays}d from:successtutoring.com`,
  ];

  const messagesById = new Map();
  queries.forEach((query) => {
    GmailApp.search(query, 0, cfg.maxThreads).forEach((thread) => {
      thread.getMessages().forEach((message) => messagesById.set(message.getId(), message));
    });
  });

  const messages = Array.from(messagesById.values());
  messages.sort((a, b) => b.getDate().getTime() - a.getDate().getTime());

  for (const message of messages) {
    const sender = extractAddress_(message.getFrom());
    if (!isPotentialCentreSender_(sender)) continue;

    try {
      let relayToken = relayTokenFromMessage_(message, cfg.relayDomain);
      let conversation = null;
      if (relayToken) {
        conversation = lookupConversation_(cfg, relayToken);
      } else {
        const route = relayRouteFromMessage_(message, cfg.relayDomain) || relayRouteFromSender_(sender);
        if (!route) continue;
        conversation = lookupCentreConversationFallback_(cfg, route, sender, message.getSubject());
        relayToken = String(conversation.relayToken || '');
      }

      if (!conversation || !relayToken) continue;
      if (String(conversation.centreInbox || '').toLowerCase() !== sender) continue;

      deliverCentreReplyToParentV2_(cfg, relayToken, conversation, message);
      console.log(`Re-delivered centre reply ${message.getId()} to ${conversation.parentEmail} without duplicating the portal log.`);
      return;
    } catch (error) {
      console.log(`Skipped centre message ${message.getId()} during recovery: ${error && error.message ? error.message : error}`);
    }
  }

  throw new Error('No recoverable centre reply was found.');
}

function installMinuteTriggerV2() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => {
      const handler = trigger.getHandlerFunction();
      return handler === 'runReplyRelay' || handler === 'runReplyRelayV2';
    })
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('runReplyRelayV2').timeBased().everyMinutes(1).create();
  console.log('Installed 1-minute reply relay V2 trigger.');
}

function testReplyRelayV2Scan() {
  const cfg = relayConfig_();
  const queries = [
    `in:inbox newer_than:${cfg.lookbackDays}d to:(${cfg.relayDomain})`,
    `in:inbox newer_than:${cfg.lookbackDays}d from:successtutoring.com.au`,
    `in:inbox newer_than:${cfg.lookbackDays}d from:successtutoring.com`,
  ];

  queries.forEach((query) => {
    const threads = GmailApp.search(query, 0, cfg.maxThreads);
    console.log(`${query} -> ${threads.length} thread(s)`);
    threads.forEach((thread) => {
      thread.getMessages().forEach((message) => {
        const sender = extractAddress_(message.getFrom());
        if (relayTokenFromMessage_(message, cfg.relayDomain) || isPotentialCentreSender_(sender)) {
          console.log(JSON.stringify({
            id: message.getId(),
            date: message.getDate().toISOString(),
            from: message.getFrom(),
            to: message.getTo(),
            subject: message.getSubject(),
            relayToken: relayTokenFromMessage_(message, cfg.relayDomain),
          }));
        }
      });
    });
  });
}
