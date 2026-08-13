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
        handleCentreReply_(cfg, relayToken, conversation, message);
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
