// FastTriggersV2.gs
// Add this file beside Code.gs and ScannerV2.gs in the ST Feedback Reply Relay
// Apps Script project. It verifies that the clean relay code is installed, then
// replaces the old single watcher with two locked one-minute watchers.

const ST_RELAY_RELEASE_VERSION = '2026-08-13-clean-v2.1';

function runReplyRelayV2FastA() {
  runReplyRelayV2Locked_('A');
}

function runReplyRelayV2FastB() {
  runReplyRelayV2Locked_('B');
}

function runReplyRelayV2Locked_(source) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) {
    console.log(`Relay ${source}: skipped because another relay scan is running.`);
    return;
  }
  const startedAt = Date.now();
  try {
    runReplyRelayV2();
    console.log(`Relay ${source}: completed in ${Date.now() - startedAt}ms.`);
  } finally {
    lock.releaseLock();
  }
}

function verifyCleanRelayCodeV2() {
  if (typeof centreRelaySubject_ !== 'function' || typeof centreRelayBody_ !== 'function') {
    throw new Error('Code.gs is missing the clean centre relay helpers. Replace Code.gs from the feature/admin-feedback-inbox-v1 branch first.');
  }

  // The clean implementation has one argument for each helper. The older ugly
  // implementation had centreRelaySubject_(subject, token) and
  // centreRelayBody_(conversation, message, body).
  if (centreRelaySubject_.length !== 1 || centreRelayBody_.length !== 1) {
    throw new Error(
      `Old Code.gs detected (subject args=${centreRelaySubject_.length}, body args=${centreRelayBody_.length}). ` +
      'Replace the entire Code.gs from the feature/admin-feedback-inbox-v1 branch before installing triggers.'
    );
  }

  const subject = centreRelaySubject_('[ST-RELAY:parramatta-test] Re: Test feedback');
  const body = centreRelayBody_('Only the new reply should be visible.');
  if (/ST-RELAY/i.test(subject) || /Original subject|Reply normally|replied to the feedback email/i.test(body)) {
    throw new Error(`Clean relay verification failed. subject=${subject}; body=${body}`);
  }

  console.log(JSON.stringify({
    ok: true,
    version: ST_RELAY_RELEASE_VERSION,
    subject,
    body,
    aliases: GmailApp.getAliases(),
  }, null, 2));
}

function installFastRelayTriggersV2() {
  verifyCleanRelayCodeV2();

  ScriptApp.getProjectTriggers()
    .filter((trigger) => /^runReplyRelay/.test(trigger.getHandlerFunction()))
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('runReplyRelayV2FastA')
    .timeBased()
    .everyMinutes(1)
    .create();

  // A second independently-created one-minute trigger generally lands on a
  // different scheduler offset. The lock prevents overlapping executions.
  Utilities.sleep(15000);
  ScriptApp.newTrigger('runReplyRelayV2FastB')
    .timeBased()
    .everyMinutes(1)
    .create();

  console.log(`Installed two locked one-minute relay triggers. Version ${ST_RELAY_RELEASE_VERSION}.`);
}

function showRelayTriggersV2() {
  console.log(JSON.stringify({
    version: ST_RELAY_RELEASE_VERSION,
    triggers: ScriptApp.getProjectTriggers().map((trigger) => ({
      functionName: trigger.getHandlerFunction(),
      source: String(trigger.getTriggerSource()),
    })),
  }, null, 2));
}
