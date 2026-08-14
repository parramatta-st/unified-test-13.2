// HistoryRelayV4.gs
//
// V4 keeps the verified V3.1 message delivery/threading behaviour, but replaces
// the expensive full-mailbox scan on every trigger run with Gmail history.list.
// Only messages added since the previous history cursor are inspected. This is
// important for a multi-centre rollout because two full scans per minute can
// consume the Workspace Gmail read/write quota even when very few replies are
// actually arriving.
//
// Dependencies:
//   - Code.gs
//   - ScannerV2.gs
//   - ThreadedRelayV3.gs
//   - CleanCentreReplyV31.gs
//   - Apps Script Gmail API advanced service (v1)

const ST_RELAY_V4_VERSION = '2026-08-14-history-v4.0';
const ST_RELAY_V4_HISTORY_PROPERTY = 'ST_REPLY_RELAY_V4_HISTORY_ID';
const ST_RELAY_V4_PROCESSED_META = 'ST_REPLY_RELAY_V4_PROCESSED_META';
const ST_RELAY_V4_PROCESSED_PREFIX = 'ST_REPLY_RELAY_V4_PROCESSED_CHUNK_';
const ST_RELAY_V4_MAX_PROCESSED_IDS = 3000;
const ST_RELAY_V4_PROCESSED_CHUNK_SIZE = 220;
const ST_RELAY_V4_MAX_HISTORY_PAGES = 20;

function runReplyRelayV4() {
  verifyHistoryRelayDependenciesV4_();

  const cfg = relayConfig_();
  const properties = PropertiesService.getScriptProperties();
  const startHistoryId = String(properties.getProperty(ST_RELAY_V4_HISTORY_PROPERTY) || '').trim();

  if (!startHistoryId) {
    console.warn('V4 history cursor was missing. Running one bounded V3.1 recovery scan before establishing a new cursor.');
    recoverHistoryCursorV4_('missing cursor');
    return;
  }

  let historyResponse;
  try {
    historyResponse = listAddedMessagesSinceV4_(startHistoryId);
  } catch (error) {
    if (historyCursorExpiredV4_(error)) {
      console.warn(`V4 history cursor ${startHistoryId} expired or became invalid. Running bounded recovery.`);
      recoverHistoryCursorV4_('expired cursor');
      return;
    }
    throw error;
  }

  const processedList = loadProcessedIdsV4_();
  const processed = new Set(processedList);
  const messages = [];

  historyResponse.messageIds.forEach((messageId) => {
    if (!messageId || processed.has(messageId)) return;
    const message = GmailApp.getMessageById(messageId);
    if (message) messages.push(message);
  });
  messages.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());

  let processedChanged = false;
  let retryRequired = false;
  let candidateCount = 0;

  messages.forEach((message) => {
    if (!isRelayCandidateV4_(message, cfg)) return;
    candidateCount += 1;

    try {
      const marked = processRelayMessageV4_(cfg, message, processedList, processed);
      if (marked) processedChanged = true;
    } catch (error) {
      retryRequired = true;
      console.error(`Reply relay V4 failed for Gmail message ${message.getId()}: ${error && error.stack ? error.stack : error}`);
    }
  });

  if (processedChanged) saveProcessedIdsV4_(processedList);

  if (!retryRequired) {
    properties.setProperty(ST_RELAY_V4_HISTORY_PROPERTY, historyResponse.latestHistoryId);
  } else {
    // Keep the old cursor. The next run sees the same history window, skips the
    // messages already recorded in the chunked processed store, and retries only
    // the message(s) that failed.
    console.warn(`V4 retained history cursor ${startHistoryId} because at least one relay candidate needs retrying.`);
  }

  console.log(JSON.stringify({
    version: ST_RELAY_V4_VERSION,
    startHistoryId,
    latestHistoryId: historyResponse.latestHistoryId,
    historyPages: historyResponse.pages,
    addedMessages: historyResponse.messageIds.length,
    relayCandidates: candidateCount,
    retryRequired,
    processedIds: processedList.length,
  }, null, 2));
}

function processRelayMessageV4_(cfg, message, processedList, processed) {
  const messageId = message.getId();
  if (!messageId || processed.has(messageId)) return false;

  const sender = extractAddress_(message.getFrom());
  let relayToken = relayTokenFromMessage_(message, cfg.relayDomain);
  let conversation = null;

  if (relayToken) {
    conversation = lookupConversation_(cfg, relayToken);
  } else {
    // Fallback is only relevant when a centre sender addressed the visible
    // @st-feedback.site alias instead of the unique reply+ address. Do not try
    // to match unrelated Success Tutoring correspondence.
    if (!isPotentialCentreSender_(sender) || !messageTargetsRelayDomainV4_(message, cfg.relayDomain)) {
      return false;
    }

    const route = relayRouteFromMessage_(message, cfg.relayDomain) || relayRouteFromSender_(sender);
    if (!route) {
      rememberProcessedV4_(processedList, processed, messageId);
      return true;
    }

    try {
      conversation = lookupCentreConversationFallback_(cfg, route, sender, message.getSubject());
    } catch (error) {
      if (permanentFallbackMissV4_(error)) {
        console.warn(`V4 ignored unmatched centre-looking message ${messageId}: ${error && error.message ? error.message : error}`);
        rememberProcessedV4_(processedList, processed, messageId);
        return true;
      }
      throw error;
    }

    relayToken = String(conversation.relayToken || '');
    if (!relayToken) throw new Error('Fallback relay lookup did not return a relay token.');
  }

  const centreInbox = String(conversation.centreInbox || '').toLowerCase();
  const fromAlias = String(conversation.fromAddress || '').toLowerCase();

  // Messages generated by the Workspace relay alias itself are expected to be
  // present in mailbox history. They are not new parent/centre input.
  if (sender && sender === fromAlias) {
    rememberProcessedV4_(processedList, processed, messageId);
    return true;
  }

  if (centreInbox && sender === centreInbox) {
    console.log(`V4 relaying centre reply ${messageId} cleanly to ${conversation.parentEmail}.`);
    handleCentreReplyCleanV31_(cfg, relayToken, conversation, message);
  } else {
    console.log(`V4 relaying parent reply ${messageId} into the centre mirror thread.`);
    handleParentReplyThreadedV3_(cfg, relayToken, conversation, message);
  }

  rememberProcessedV4_(processedList, processed, messageId);
  return true;
}

function listAddedMessagesSinceV4_(startHistoryId) {
  let pageToken = '';
  let pages = 0;
  let latestHistoryId = String(startHistoryId);
  const messageIds = new Set();

  do {
    const params = {
      startHistoryId: String(startHistoryId),
      maxResults: 500,
      historyTypes: ['messageAdded'],
    };
    if (pageToken) params.pageToken = pageToken;

    const response = Gmail.Users.History.list('me', params) || {};
    latestHistoryId = String(response.historyId || latestHistoryId);

    (response.history || []).forEach((record) => {
      (record.messagesAdded || []).forEach((entry) => {
        const id = entry && entry.message ? String(entry.message.id || '') : '';
        if (id) messageIds.add(id);
      });
    });

    pageToken = String(response.nextPageToken || '');
    pages += 1;
    if (pageToken && pages >= ST_RELAY_V4_MAX_HISTORY_PAGES) {
      throw new Error(`V4 history pagination exceeded ${ST_RELAY_V4_MAX_HISTORY_PAGES} pages; cursor was not advanced.`);
    }
  } while (pageToken);

  return {
    messageIds: Array.from(messageIds),
    latestHistoryId,
    pages,
  };
}

function isRelayCandidateV4_(message, cfg) {
  if (relayTokenFromMessage_(message, cfg.relayDomain)) return true;
  const sender = extractAddress_(message.getFrom());
  return isPotentialCentreSender_(sender) && messageTargetsRelayDomainV4_(message, cfg.relayDomain);
}

function messageTargetsRelayDomainV4_(message, relayDomain) {
  const recipients = `${message.getTo() || ''},${message.getCc() || ''}`.toLowerCase();
  return recipients.includes(`@${String(relayDomain || '').toLowerCase()}`);
}

function permanentFallbackMissV4_(error) {
  const text = String(error && error.message ? error.message : error || '');
  return /Fallback relay lookup failed \((?:400|404|409)\)/i.test(text);
}

function historyCursorExpiredV4_(error) {
  const text = String(error && error.message ? error.message : error || '');
  return /(?:404|not found|startHistoryId|history id|historyId).*?(?:invalid|expired|not found|requested entity)/i.test(text)
    || /Requested entity was not found/i.test(text);
}

function recoverHistoryCursorV4_(reason) {
  verifyHistoryRelayDependenciesV4_();

  const profile = Gmail.Users.getProfile('me');
  const baselineHistoryId = String(profile && profile.historyId ? profile.historyId : '');
  if (!baselineHistoryId) throw new Error('Gmail API did not return a historyId during V4 recovery.');

  // Capture any currently-visible relay messages using the already-proven V3.1
  // bounded scan. The baseline was taken first, so messages arriving during the
  // recovery are still returned by the next history.list call. Duplicates are
  // suppressed by the processed stores and webhook idempotency.
  runReplyRelayV31();

  const migrated = uniqueIdsV4_(loadProcessedIdsV4_().concat(loadProcessedIds_()));
  saveProcessedIdsV4_(migrated);
  PropertiesService.getScriptProperties().setProperty(ST_RELAY_V4_HISTORY_PROPERTY, baselineHistoryId);

  console.log(JSON.stringify({
    ok: true,
    version: ST_RELAY_V4_VERSION,
    recoveryReason: reason,
    baselineHistoryId,
    migratedProcessedIds: migrated.length,
  }, null, 2));
}

function loadProcessedIdsV4_() {
  const properties = PropertiesService.getScriptProperties();
  const metaRaw = String(properties.getProperty(ST_RELAY_V4_PROCESSED_META) || '');

  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw);
      const chunkCount = Math.max(0, Math.floor(Number(meta.chunks || 0)));
      const ids = [];
      for (let index = 0; index < chunkCount; index += 1) {
        const raw = properties.getProperty(processedChunkKeyV4_(index)) || '[]';
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) ids.push.apply(ids, parsed);
      }
      return uniqueIdsV4_(ids).slice(-ST_RELAY_V4_MAX_PROCESSED_IDS);
    } catch (error) {
      console.warn(`V4 processed-ID chunks could not be read; falling back to the legacy store: ${error}`);
    }
  }

  // One-time backwards-compatible migration path from Code.gs.
  return uniqueIdsV4_(loadProcessedIds_()).slice(-ST_RELAY_V4_MAX_PROCESSED_IDS);
}

function saveProcessedIdsV4_(ids) {
  const properties = PropertiesService.getScriptProperties();
  const clean = uniqueIdsV4_(ids).slice(-ST_RELAY_V4_MAX_PROCESSED_IDS);
  const chunks = chunkProcessedIdsV4_(clean);
  const existing = properties.getProperties();

  Object.keys(existing).forEach((key) => {
    if (key === ST_RELAY_V4_PROCESSED_META || key.startsWith(ST_RELAY_V4_PROCESSED_PREFIX)) {
      properties.deleteProperty(key);
    }
  });

  const values = {};
  chunks.forEach((chunk, index) => {
    values[processedChunkKeyV4_(index)] = JSON.stringify(chunk);
  });
  values[ST_RELAY_V4_PROCESSED_META] = JSON.stringify({
    version: 1,
    chunks: chunks.length,
    count: clean.length,
    updatedAt: new Date().toISOString(),
  });
  properties.setProperties(values, false);
}

function rememberProcessedV4_(list, set, messageId) {
  const id = String(messageId || '');
  if (!id || set.has(id)) return;
  list.push(id);
  set.add(id);
  while (list.length > ST_RELAY_V4_MAX_PROCESSED_IDS) {
    const removed = list.shift();
    set.delete(removed);
  }
}

function uniqueIdsV4_(ids) {
  const seen = new Set();
  const output = [];
  (ids || []).forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    output.push(id);
  });
  return output;
}

function chunkProcessedIdsV4_(ids) {
  const chunks = [];
  for (let index = 0; index < ids.length; index += ST_RELAY_V4_PROCESSED_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + ST_RELAY_V4_PROCESSED_CHUNK_SIZE));
  }
  return chunks;
}

function processedChunkKeyV4_(index) {
  return `${ST_RELAY_V4_PROCESSED_PREFIX}${String(index).padStart(3, '0')}`;
}

function verifyHistoryRelayDependenciesV4_() {
  verifyGmailAdvancedServiceV3_();
  if (!Gmail.Users.History || typeof Gmail.Users.History.list !== 'function') {
    throw new Error('The Gmail API history service is unavailable. Keep Gmail API v1 enabled under Apps Script Services.');
  }
  if (typeof runReplyRelayV31 !== 'function' ||
      typeof handleCentreReplyCleanV31_ !== 'function' ||
      typeof handleParentReplyThreadedV3_ !== 'function') {
    throw new Error('V4 dependencies are missing. Keep Code.gs, ScannerV2.gs, ThreadedRelayV3.gs and CleanCentreReplyV31.gs installed.');
  }
}

function verifyHistoryRelayV4() {
  verifyHistoryRelayDependenciesV4_();

  const profile = Gmail.Users.getProfile('me');
  const historyId = String(profile && profile.historyId ? profile.historyId : '');
  if (!historyId) throw new Error('Gmail API did not return the current mailbox historyId.');

  // Confirm the advanced-service method signature before any trigger switch.
  const probe = Gmail.Users.History.list('me', {
    startHistoryId: historyId,
    maxResults: 1,
    historyTypes: ['messageAdded'],
  }) || {};

  const sampleIds = [];
  for (let index = 0; index < 700; index += 1) sampleIds.push(`test-${String(index).padStart(4, '0')}`);
  const chunks = chunkProcessedIdsV4_(sampleIds);
  const tooLarge = chunks.some((chunk) => JSON.stringify(chunk).length >= 8000);
  const restored = [].concat.apply([], chunks);
  if (tooLarge || restored.length !== sampleIds.length) {
    throw new Error('V4 chunked processed-ID storage self-test failed.');
  }

  console.log(JSON.stringify({
    ok: true,
    version: ST_RELAY_V4_VERSION,
    gmailApi: true,
    historyApi: true,
    currentHistoryId: historyId,
    probeHistoryId: String(probe.historyId || historyId),
    processedStorage: 'chunked below the 9 KB property-value limit',
    sampleChunks: chunks.length,
    deliveryMode: 'V3.1 unchanged',
    aliases: GmailApp.getAliases(),
  }, null, 2));
}

function installHistoryRelayV4() {
  verifyHistoryRelayV4();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const profile = Gmail.Users.getProfile('me');
    const baselineHistoryId = String(profile && profile.historyId ? profile.historyId : '');
    if (!baselineHistoryId) throw new Error('Gmail API did not return a historyId during V4 installation.');

    // Complete one final bounded V3.1 scan before switching. Taking the baseline
    // first means any messages arriving during this scan remain visible to V4.
    runReplyRelayV31();
    const migrated = uniqueIdsV4_(loadProcessedIdsV4_().concat(loadProcessedIds_()));
    saveProcessedIdsV4_(migrated);
    PropertiesService.getScriptProperties().setProperty(ST_RELAY_V4_HISTORY_PROPERTY, baselineHistoryId);

    ScriptApp.getProjectTriggers()
      .filter((trigger) => /^runReplyRelay/.test(trigger.getHandlerFunction()))
      .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

    ScriptApp.newTrigger('runReplyRelayV4FastA').timeBased().everyMinutes(1).create();
    Utilities.sleep(15000);
    ScriptApp.newTrigger('runReplyRelayV4FastB').timeBased().everyMinutes(1).create();

    console.log(`Installed two locked Gmail-history V4 triggers. Version ${ST_RELAY_V4_VERSION}.`);
  } finally {
    lock.releaseLock();
  }
}

function runReplyRelayV4FastA() {
  runReplyRelayV4Locked_('A');
}

function runReplyRelayV4FastB() {
  runReplyRelayV4Locked_('B');
}

function runReplyRelayV4Locked_(source) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    console.log(`Relay V4 ${source}: skipped because another history run is active.`);
    return;
  }
  const startedAt = Date.now();
  try {
    runReplyRelayV4();
    console.log(`Relay V4 ${source}: completed in ${Date.now() - startedAt}ms.`);
  } finally {
    lock.releaseLock();
  }
}

function showRelayStatusV4() {
  const properties = PropertiesService.getScriptProperties();
  const metaRaw = String(properties.getProperty(ST_RELAY_V4_PROCESSED_META) || '{}');
  let meta = {};
  try { meta = JSON.parse(metaRaw); } catch (_) {}

  console.log(JSON.stringify({
    version: ST_RELAY_V4_VERSION,
    historyId: String(properties.getProperty(ST_RELAY_V4_HISTORY_PROPERTY) || ''),
    processedStore: meta,
    triggers: ScriptApp.getProjectTriggers().map((trigger) => ({
      functionName: trigger.getHandlerFunction(),
      source: String(trigger.getTriggerSource()),
    })),
  }, null, 2));
}
