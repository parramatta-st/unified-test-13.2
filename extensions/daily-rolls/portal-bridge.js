/* Runs only on the named portal origin. Auth stays in the portal's signed cookie. */
(() => {
  if(!['https://unified-site.successtutoringparramatta.com','https://unified-test-13-2.vercel.app'].includes(location.origin))return;
  // The worker can reconnect an existing tab. Concurrent tutor/student syncs
  // must not register two listeners and send each import twice.
  if(globalThis.__stpRollsPortalBridge)chrome.runtime.onMessage.removeListener(globalThis.__stpRollsPortalBridge);
  const listener=(message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||message?.namespace!=='stp-rolls'||message.type!=='PORTAL_SCHEDULE_REQUEST')return;
    const body=message.body;
    if(!body||!['begin_collection','import_schedule','begin_feedback_collection','import_feedback_schedule'].includes(body.action)){respond({ok:false,error:'Invalid schedule request.'});return;}
    (async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
      try{
        const endpoint=body.action==='begin_feedback_collection'||body.action==='import_feedback_schedule'?'/api/admin/feedback-rolls':'/api/admin/hapana-schedule';
        const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
        const result=await response.json().catch(()=>({}));
        if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||`The portal schedule API is not available (HTTP ${response.status}). Sign in as an admin and check the portal update is installed.`),{status:response.status,recollect:[400,401,409].includes(response.status)});
        return result;
      }finally{clearTimeout(timer);}
    })().then(respond,error=>respond({ok:false,status:error.status,recollect:!!error.recollect,error:error.name==='AbortError'?'Portal confirmation timed out. Retry syncing the same collection.':error.message}));
    return true;
  };
  globalThis.__stpRollsPortalBridge=listener;
  chrome.runtime.onMessage.addListener(listener);
})();
