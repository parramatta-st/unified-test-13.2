function createFeedbackSyncUI({installed,demo,getCapture,getTicket,background,onBusyChange=()=>{},recollect=()=>{}}) {
  const status=document.getElementById('feedback-sync-status'),retry=document.getElementById('feedback-sync-retry');
  let busy=false,needsCollection=false;
  function message(text,error=false){status.textContent=text;status.setAttribute('role',error?'alert':'status');status.className=error?'hint schedule-error':'hint';}
  async function save(){
    if(busy||!installed||demo)return;
    busy=true;onBusyChange(true);retry.disabled=true;message('Sending the verified student bookings to Feedback…');
    try{
      const capture=getCapture();
      let ticket;
      try{ticket=getTicket();}catch(error){needsCollection=true;throw error;}
      const result=await background('SYNC_FEEDBACK_SCHEDULE',{capture,ticket});
      message(`Student bookings synced to Feedback · ${result.date} · ${result.sessions} classes · ${result.bookings} bookings. Open “Link tutors and students” below to check any names that need linking, then refresh Feedback.`);
      needsCollection=false;
    }catch(error){needsCollection=needsCollection||!!error.recollect;message(`Student bookings have NOT been confirmed in Feedback: ${error.message}${needsCollection?' Sign in as an admin, then use “Reconnect and recollect” below.':''} Local rolls and printing are still available.`,true);}
    finally{busy=false;onBusyChange(false);retry.disabled=false;retry.textContent=needsCollection?'Reconnect and recollect':'Retry student sync';}
  }
  function incomplete(){needsCollection=false;retry.disabled=true;retry.textContent='Retry student sync';message('Collect and verify this day before sending student bookings to Feedback.');}
  retry.addEventListener('click',()=>needsCollection?recollect():save());
  incomplete();
  return{save,incomplete,isBusy:()=>busy};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createFeedbackSyncUI;
