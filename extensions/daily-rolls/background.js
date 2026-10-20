importScripts('reader.js');
importScripts('schedule-model.js');
const reader = createHapanaReader();
const scheduleModel = createScheduleModel();
const SCHEDULE_PREFIX = 'stp-schedule-v1:parramatta:';
// All read/modify/write operations run in the sole service worker, in order.
let scheduleQueue = Promise.resolve();
const PORTAL_ORIGIN = 'https://unified-site.successtutoringparramatta.com';
async function portalRequest(body) {
  const tabs=await chrome.tabs.query({url:PORTAL_ORIGIN+'/*'});
  const tab=tabs[0]||await chrome.tabs.create({url:PORTAL_ORIGIN+'/admin/feedback-schedule',active:false});
  let last='Open the portal and sign in as an admin.';
  for(let attempt=0;attempt<20;attempt++) {
    try {
      const result=await chrome.tabs.sendMessage(tab.id,{namespace:'stp-rolls',type:'PORTAL_SCHEDULE_REQUEST',body});
      if(result?.ok)return result;
      throw Object.assign(new Error(result?.error||'The portal did not confirm the schedule request.'),{portalResponse:true});
    }catch(error){if(error.portalResponse)throw error;last=error.message;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('Could not reach the signed-in portal. Refresh its tab after updating the extension. '+last);
}
const scheduleTask = task => {
  const pending = scheduleQueue.then(task);
  scheduleQueue = pending.catch(() => {});
  return pending;
};
const PREFIX = 'collector:';
const trustedReview = sender => {
  try { const url=new URL(sender.url),expected=new URL(chrome.runtime.getURL('review.html')); return !!sender.tab?.id && url.protocol===expected.protocol && url.host===expected.host && url.pathname==='/review.html'; } catch { return false; }
};
async function openReview(sourceTabId) {
  await chrome.tabs.create({url:chrome.runtime.getURL(`review.html?source=${sourceTabId || ''}`)});
}
chrome.action.onClicked.addListener(tab => openReview(tab.id));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.namespace !== 'stp-rolls') return;
  (async () => {
    if (message.type === 'OPEN_REVIEW') {
      if (sender.tab?.id && sender.url?.startsWith('https://core.hapana.com/')) await openReview(sender.tab.id);
      else throw new Error('Open the extension from a Hapana schedule tab.');
      return {ok:true};
    }
    if (!trustedReview(sender)) throw new Error('Only the extension review screen may collect sessions.');
    if(message.type==='BEGIN_FEEDBACK_SYNC')return portalRequest({action:'begin_feedback_collection',date:message.date,captureId:message.captureId});
    if(message.type==='SYNC_FEEDBACK_SCHEDULE')return portalRequest({action:'import_feedback_schedule',capture:message.capture,ticket:message.ticket});
    if(message.type==='BEGIN_SCHEDULE_SYNC')return portalRequest({action:'begin_collection',date:message.date,captureId:message.captureId});
    if(message.type==='SYNC_SCHEDULE') {
      const capture=scheduleModel.validateCapture(message.capture);
      return portalRequest({action:'import_schedule',capture,ticket:message.ticket});
    }
    if (message.type === 'SAVE_SCHEDULE') return scheduleTask(async () => {
      const capture=scheduleModel.validateCapture(message.capture);
      const scheduleKey=SCHEDULE_PREFIX+capture.date;
      const previous=(await chrome.storage.local.get(scheduleKey))[scheduleKey];
      const result=scheduleModel.apply(previous,capture);
      if (!result.replayed) await chrome.storage.local.set({[scheduleKey]:result.record});
      return {ok:true,...result};
    });
    if (message.type === 'GET_SCHEDULE') return scheduleTask(async () => {
      if (!scheduleModel.dateValid(message.date)) throw new Error('Invalid schedule date.');
      const scheduleKey=SCHEDULE_PREFIX+message.date;
      return {ok:true,record:(await chrome.storage.local.get(scheduleKey))[scheduleKey]||null};
    });
    const key = PREFIX + sender.tab.id;
    if (message.type === 'OPEN_COLLECTOR') {
      const ref = reader.sessionRef(message.url);
      if (!ref) throw new Error('Invalid Hapana session link.');
      const old = (await chrome.storage.session.get(key))[key];
      if (old) { try { await chrome.tabs.remove(old); } catch {} }
      const tab = await chrome.tabs.create({url:ref.url,active:false});
      await chrome.storage.session.set({[key]:tab.id});
      return {ok:true,tabId:tab.id};
    }
    if (message.type === 'NAVIGATE_COLLECTOR') {
      const ref = reader.sessionRef(message.url);
      const tabId = (await chrome.storage.session.get(key))[key];
      if (!ref || !tabId) throw new Error('The collection tab is no longer available. Retry collection.');
      await chrome.tabs.update(tabId, {url:ref.url});
      return {ok:true,tabId};
    }
    if (message.type === 'CLOSE_COLLECTOR') {
      const tabId = (await chrome.storage.session.get(key))[key];
      if (tabId) { try { await chrome.tabs.remove(tabId); } catch {} }
      await chrome.storage.session.remove(key);
      return {ok:true};
    }
    throw new Error('Unknown request.');
  })().then(respond, error => respond({ok:false,error:error.message}));
  return true;
});
// Remove only collector tabs created for this extension page, never a user's Hapana tab.
chrome.tabs.onRemoved.addListener(async tabId => {
  const key = PREFIX + tabId;
  const collector = (await chrome.storage.session.get(key))[key];
  if (collector) { try { await chrome.tabs.remove(collector); } catch {} }
  await chrome.storage.session.remove(key);
});
