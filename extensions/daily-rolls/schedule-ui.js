/* Part 1: browser-local tutor schedule history, with explicit save failures. */
function createScheduleUI({installed,demo,getCapture,getPortalTicket,background}) {
  const $=id=>document.getElementById(id), model=createRollModel();
  let record=null, busy=false, selectedDate='', request=0;
  const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const time=value=>model.formatTime(value);
  function message(text,error=false) {
    $('schedule-status').textContent=text;
    $('schedule-status').setAttribute('role',error?'alert':'status');
    $('schedule-status').className=error?'hint schedule-error':'hint';
  }
  function render() {
    $('schedule-export').disabled=!record||busy||demo;
    $('schedule-load').disabled=busy||!installed||demo;
    $('schedule-retry').disabled=busy||!installed||demo;
    $('schedule-date').disabled=busy||demo;
    $('schedule-list').replaceChildren();$('schedule-history').replaceChildren();
    if (!record) return;
    const table=node('table'),head=node('tr');
    for(const label of ['Tutor','Scheduled session','Class'])head.append(node('th',label));
    const thead=node('thead');thead.append(head);table.append(thead);
    const tbody=node('tbody');
    for(const s of record.sessions) {
      const row=node('tr');row.append(node('td',s.tutorName),node('td',`${time(s.startMinute)} – ${time(s.endMinute)}`),node('td',s.sessionTitle));tbody.append(row);
    }
    table.append(tbody);$('schedule-list').append(table);
    for(const revision of [...record.revisions].reverse()) {
      const when=new Intl.DateTimeFormat('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:'Australia/Sydney'}).format(new Date(revision.capture.completedAt));
      const item=node('li',`Revision ${revision.revision} · ${when} · ${revision.capture.mode==='replace_day'?'Full day confirmed':'Visible classes updated'}`);
      const changes=node('ul');
      for(const change of revision.changes) {
        const s=change.after||change.before;
        const label=change.type==='tutor_changed'?`${change.before.tutorName} → ${change.after.tutorName}`:change.type==='removed'?`${s.tutorName}: removed from this day`:change.type==='added'?`${s.tutorName}: added`:`${s.tutorName}: class details updated`;
        changes.append(node('li',`${time(s.startMinute)} · ${s.sessionTitle} · ${label}`));
      }
      if(!revision.changes.length)changes.append(node('li','No assignment changes.'));
      item.append(changes);$('schedule-history').append(item);
    }
    if(record.historyTruncated)$('schedule-history').append(node('li','Only the latest 50 revisions for this day are retained locally.'));
  }
  async function load(date) {
    if(busy)return;
    const token=++request;
    selectedDate=date;$('schedule-date').value=date;record=null;render();
    if(!installed||demo)return;
    message('Reading the saved tutor schedule…');
    try {
      const result=await background('GET_SCHEDULE',{date});
      if(token!==request)return;
      record=result.record;
      message(record?`Saved on this browser · ${record.date} · revision ${record.revision} · ${record.sessions.length} classes. Viewing a local record does not confirm portal sync.`:'No tutor schedule has been saved for this date on this browser.');
    } catch(error){if(token===request)message(`Could not read the saved schedule: ${error.message}`,true);}
    if(token===request)render();
  }
  async function save() {
    if(busy||!installed||demo)return;
    let capture;
    try { capture=getCapture(); } catch(error) {message(`Tutor schedule was not saved: ${error.message} The previous saved record is unchanged.`,true);return;}
    const token=++request;
    busy=true;selectedDate=capture.date;$('schedule-date').value=selectedDate;record=null;render();
    message('Saving the verified tutor schedule on this browser…');
    try {
      const result=await background('SAVE_SCHEDULE',{capture});
      if(token===request){record=result.record;message(`Saved on this browser · ${capture.date} · revision ${record.revision} · ${record.sessions.length} classes. ${capture.mode==='replace_day'?'Full day confirmed.':'Classes not seen in this collection were kept.'}`);}
      if(getPortalTicket) {
        try {
          const ticket=getPortalTicket();
          await background('SYNC_SCHEDULE',{capture,ticket});
          if(token===request)message(`Saved locally and synced to the portal · ${capture.date} · revision ${record.revision}. ${capture.mode==='replace_day'?'Full day confirmed.':'Only visible classes updated; unseen classes were kept.'}`);
        }catch(error){if(token===request)message(`Saved locally. Portal sync was not confirmed: ${error.message} Printing is still available. Retry syncing with this collection or collect again.`,true);}
      }
    } catch(error) {
      // Reload the last durable record; never disguise an unsuccessful write as success.
      try {if(token===request)record=(await background('GET_SCHEDULE',{date:capture.date})).record;}catch{}
      if(token===request)message(`Tutor schedule was not saved: ${error.message} Previous records are unchanged. Retry saving after fixing the problem.`,true);
    } finally {busy=false;render();}
  }
  function incomplete(){message('The new collection is incomplete. The previous saved tutor schedule is unchanged.',true);}
  function exportRecord() {
    if(!record||busy||demo)return;
    const payload={format:'stp-hapana-schedule-export',schemaVersion:1,exportedAt:new Date().toISOString(),storage:'browser_local_backup',portalSyncConfirmedByExport:false,day:record};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const a=node('a');a.href=url;a.download=`STP-Tutor-Schedule-${record.date}-r${record.revision}.json`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('schedule-load').addEventListener('click',()=>load($('schedule-date').value));
  $('schedule-retry').addEventListener('click',save);
  $('schedule-export').addEventListener('click',exportRecord);
  const parts=new Intl.DateTimeFormat('en-AU',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Australia/Sydney'}).formatToParts(new Date());
  const part=type=>parts.find(p=>p.type===type).value;
  selectedDate=`${part('year')}-${part('month')}-${part('day')}`;$('schedule-date').value=selectedDate;
  if(demo)message('Demo schedules are never saved or exported.');
  else if(!installed)message('Load this folder as a Chrome extension to save tutor schedules.');
  else load(selectedDate);
  render();
  return {load,save,incomplete};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createScheduleUI;
