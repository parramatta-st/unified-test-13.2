function createFeedbackSyncUI({installed,demo,getCapture,getTicket,background}) {
  const status=document.getElementById('feedback-sync-status'),retry=document.getElementById('feedback-sync-retry');
  let busy=false;
  function message(text,error=false){status.textContent=text;status.setAttribute('role',error?'alert':'status');status.className=error?'hint schedule-error':'hint';}
  async function save(){
    if(busy||!installed||demo)return;
    busy=true;retry.disabled=true;message('Sending the verified student bookings to Feedback…');
    try{
      const capture=getCapture(),ticket=getTicket();
      const result=await background('SYNC_FEEDBACK_SCHEDULE',{capture,ticket});
      message(`Student bookings synced to Feedback · ${result.date} · ${result.sessions} classes · ${result.bookings} bookings. Open “Link tutors and students” below to check any names that need linking, then refresh Feedback.`);
    }catch(error){message(`Student bookings have NOT been confirmed in Feedback: ${error.message} Local rolls and printing are still available.`,true);}
    finally{busy=false;retry.disabled=false;}
  }
  function incomplete(){retry.disabled=true;message('Collect and verify this day before sending student bookings to Feedback.');}
  retry.addEventListener('click',save);
  incomplete();
  return{save,incomplete};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createFeedbackSyncUI;
