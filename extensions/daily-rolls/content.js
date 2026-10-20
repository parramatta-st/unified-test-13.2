(() => {
  const reader = createHapanaReader();
  const route = () => new URL(location.href).searchParams.get('route');
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message || message.namespace !== 'stp-rolls') return;
    try {
      if (message.type === 'READ_DAY') respond({ok:true, data:reader.readDay(document, location.href)});
      else if (message.type === 'READ_SESSION') respond({ok:true, data:reader.readSession(document, location.href, message.expected)});
    } catch (error) {
      respond({ok:false, error:error.message, login:/\/login(?:$|[?#])/.test(location.href)});
    }
  });
  if (route() !== 'dashboard/schedule') return;
  createRollLauncher({document, runtime:chrome.runtime, isSchedule:()=>route()==='dashboard/schedule',
    MutationObserver, requestAnimationFrame:window.requestAnimationFrame.bind(window)}).start();
})();
