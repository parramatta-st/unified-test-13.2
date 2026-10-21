/* No server, external fonts, analytics, credential access or booking mutations. */
(() => {
  const model = createRollModel(), reader = createHapanaReader(), printFitter = createPrintFitter();
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1';
  const installed = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  const sourceId = Number(params.get('source'));
  let day = null, sessions = [], errors = [], collecting = false, stopped = false, collectorId = null, previewKind = 'all';
  let collectedTime = '';
  const scheduleModel=createScheduleModel();
  let captureStartedAt='',captureId='',captureFullDay=false,savingSchedule=false,captureVerified=false;
  let portalTicket='',portalStartError='';
  let feedbackTicket='',feedbackStartError='';
  const feedbackModel=createFeedbackModel();
  const feedbackUI=createFeedbackSyncUI({installed,demo,background,onBusyChange:busy=>{$('refresh').disabled=busy||collecting||savingSchedule;},getTicket:()=>{
    if(!feedbackTicket)throw new Error(feedbackStartError||'Sign in to the portal as an admin and collect again.');
    return feedbackTicket;
  },getCapture:()=>{
    if(!captureVerified)throw new Error('The latest collection has not been fully verified. Collect or retry the day first.');
    return feedbackModel.capture({day,sessions,errors,collecting,demo,startedAt:captureStartedAt,completedAt:collectedTime,captureId,fullDay:captureFullDay});
  }});
  const scheduleUI=createScheduleUI({installed,demo,background,getPortalTicket:()=>{
    if(!portalTicket)throw new Error(portalStartError||'Collect this day again while signed in to the portal as an admin.');
    return portalTicket;
  },getCapture:()=>{
    if(!captureVerified)throw new Error('The latest collection has not been fully verified. Collect or retry the day first.');
    return scheduleModel.capture({day,sessions,errors,collecting,demo,startedAt:captureStartedAt,completedAt:collectedTime,captureId,fullDay:captureFullDay});
  }});
  const element = (tag, className, text) => { const el=document.createElement(tag); if(className) el.className=className; if(text!==undefined) el.textContent=text; return el; };
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  async function background(type, data={}) {
    const response=await chrome.runtime.sendMessage({namespace:'stp-rolls',type,...data});
    if(!response?.ok) throw new Error(response?.error || 'The extension could not respond. Reload it and refresh Hapana.');
    return response;
  }
  function status(title,detail,kind='') { $('status').textContent=title; $('status-detail').textContent=detail; $('status-dot').className='dot '+kind; }
  function addStat(value,label) { const block=element('div','stat'); block.append(element('strong','',value),element('span','',label)); $('stats').append(block); }
  function renderStats() {
    $('stats').replaceChildren();
    if(!day) return;
    addStat(sessions.length+'/'+day.sessions.length,'classes read');
    addStat(sessions.reduce((n,s)=>n+s.students.length,0),'bookings');
    addStat(sessions.filter(s=>!s.room).length,'rooms to choose');
    addStat(day.excluded.length,'excluded sessions');
  }
  function renderErrors() {
    const box=$('errors'); box.replaceChildren(); box.hidden=!errors.length;
    if(!errors.length) return;
    box.append(element('strong','','Some classes could not be verified. Printing is disabled to prevent an incomplete roll.'));
    const list=element('ul');
    for(const item of errors) list.append(element('li','',`${item.ref.name}: ${item.error}`));
    const retry=element('button','button secondary','Retry failed classes'); retry.disabled=collecting;
    retry.addEventListener('click',()=>collect(errors.map(e=>e.ref),false));
    box.append(list,retry);
  }
  function renderBoard() {
    const board=$('board'); board.replaceChildren();
    for(const room of ['',...model.rooms]) {
      const assigned=sessions.filter(s=>s.room===room).sort((a,b)=>a.start-b.start||a.name.localeCompare(b.name));
      if(!room&&!assigned.length) continue;
      const column=element('section','room-column'+(!room?' unassigned':'')); column.dataset.room=room;
      const title=element('div','room-title');
      title.append(element('span','room-number',room||'?'),element('h3','',room?`Room ${room}`:'Choose a room'),element('small','',`${assigned.length} ${assigned.length===1?'class':'classes'}`));
      column.append(title);
      const cards=element('div','cards');
      if(!assigned.length) cards.append(element('p','empty-room','Drop a class here, or choose this room from a class dropdown.'));
      for(const session of assigned) {
        const card=element('article','class-card'); card.draggable=!collecting; card.dataset.id=session.id;
        card.append(element('div','class-time',`${model.formatTime(session.start)} – ${model.formatTime(session.end)}`),element('h4','',session.name),element('p','class-tutor',session.tutor));
        const meta=element('div','class-meta'); meta.append(element('span','',`${session.booked} ${session.booked===1?'student':'students'}`));
        const select=element('select','room-select'); select.setAttribute('aria-label',`Room for ${session.name}, ${model.formatTime(session.start)}, ${session.tutor}`); select.disabled=collecting;
        for(const value of ['',...model.rooms]) { const option=element('option','',value?`Room ${value}`:'Choose room'); option.value=value; select.append(option); }
        select.value=session.room;
        select.addEventListener('change',()=>setRoom(session.id,select.value)); meta.append(select); card.append(meta);
        for(const warning of session.warnings||[]) card.append(element('p','warning',warning));
        const detail=element('details'); detail.append(element('summary','',`View ${session.students.length} names`));
        const names=element('ul','student-list'); for(const student of session.students) names.append(element('li','',student.name)); detail.append(names); card.append(detail);
        card.addEventListener('dragstart',event=> { event.dataTransfer.setData('text/plain',session.id); event.dataTransfer.effectAllowed='move'; card.classList.add('dragging'); });
        card.addEventListener('dragend',()=>card.classList.remove('dragging'));
        cards.append(card);
      }
      column.append(cards);
      column.addEventListener('dragover',event=> {if(!collecting){event.preventDefault();event.dataTransfer.dropEffect='move';column.classList.add('drag-over');}});
      column.addEventListener('dragleave',event=>{if(!column.contains(event.relatedTarget))column.classList.remove('drag-over');});
      column.addEventListener('drop',event=>{event.preventDefault();column.classList.remove('drag-over');if(!collecting)setRoom(event.dataTransfer.getData('text/plain'),room);});
      board.append(column);
    }
  }
  function setRoom(id,room) {
    if(room!==''&&!model.rooms.includes(room))return;
    const session=sessions.find(s=>s.id===id); if(!session)return;
    sessions=model.assignRoom(sessions,id,room); render();
    // Restore keyboard focus after re-rendering the board.
    const card=[...document.querySelectorAll('.class-card')].find(el=>el.dataset.id===id);
    card?.querySelector('select')?.focus({preventScroll:true});
  }
  function render() {
    $('allocation').hidden=!day;
    $('refresh').disabled=collecting; $('cancel').hidden=!collecting;
    $('suggest').disabled=collecting||!sessions.length; $('clear').disabled=collecting||!sessions.length;
    renderStats(); renderBoard(); renderErrors();
    const reason=model.validate(sessions,errors,collecting);
    $('print-reason').textContent=reason||'Ready. Overlapping classes with the same tutor move together. Each class keeps its own labelled section.';
    for(const id of ['preview-rooms','preview-tutors','print-all']) $(id).disabled=!!reason;
    if(day) {
      $('date-heading').textContent=model.fullDate(day.date);
      $('excluded-summary').textContent=`${day.excluded.length} assessment / one-to-one sessions excluded`;
      $('excluded-list').replaceChildren(...day.excluded.map(s=>element('li','',`${model.formatTime(s.start)} · ${s.name}`)));
    }
  }
  async function start() {
    if(collecting||savingSchedule||feedbackUI.isBusy())return;
    if(demo){loadDemo();return;}
    if(!installed||!sourceId) { $('welcome').hidden=false; status('Open this from Hapana','Use the new button on Hapana’s selected Day view. You can also explore the sample screen below.'); return; }
    if(sessions.length&&!confirm('Collect fresh bookings from the selected Hapana day? Your current room choices will be reset.'))return;
    $('welcome').hidden=true; $('refresh').disabled=true;
    portalTicket='';portalStartError='';feedbackTicket='';feedbackStartError='';captureVerified=false;feedbackUI.incomplete();captureStartedAt=new Date().toISOString();captureId=crypto.randomUUID();captureFullDay=$('schedule-full-day').checked;
    $('schedule-full-day').disabled=true;
    status('Reading the selected day…','Keep Hapana’s source tab open. Clear any schedule filters first.','busy');
    try {
      const response=await chrome.tabs.sendMessage(sourceId,{namespace:'stp-rolls',type:'READ_DAY'});
      if(!response?.ok) throw new Error(response?.error||'The Hapana day could not be read.');
      day=response.data; sessions=[]; errors=[]; render();scheduleUI.load(day.date);
      if(!day.sessions.length) { scheduleUI.incomplete();status('No included group classes','All visible sessions are assessments or one-to-one sessions, which you chose to leave out.'); return; }
      status('Connecting the tutor schedule…','Checking your admin sign-in on the portal. Class collection and printing can still work if sync is unavailable.','busy');
      await Promise.all([
        (async()=>{try{portalTicket=(await background('BEGIN_SCHEDULE_SYNC',{date:day.date,captureId})).ticket;}catch(error){portalStartError=error.message;}})(),
        (async()=>{try{feedbackTicket=(await background('BEGIN_FEEDBACK_SYNC',{date:day.date,captureId})).ticket;}catch(error){feedbackStartError=error.message;}})()
      ]);
      await collect(day.sessions,true);
    } catch(error) {
      scheduleUI.incomplete();
      status('Could not read the day',/Receiving end|Could not establish|No tab/.test(error.message)?'Refresh the Hapana tab after installing the extension. Select Day view, clear filters and reopen Daily Rolls from that tab.':error.message,'error');
    } finally { $('refresh').disabled=false;$('schedule-full-day').disabled=false; }
  }
  async function readLoaded(ref) {
    const deadline=Date.now()+45000;
    let lastError='The page did not finish loading.', previous='', stableSince=0;
    while(Date.now()<deadline) {
      if(stopped)throw new Error('Collection stopped. Retry this class to include it.');
      try {
        const result=await chrome.tabs.sendMessage(collectorId,{namespace:'stp-rolls',type:'READ_SESSION',expected:ref});
        if(result?.login) {const err=new Error('Your Hapana sign-in expired. Sign in in your Hapana tab and retry.');err.authentication=true;throw err;}
        if(result?.ok) {
          const fingerprint=JSON.stringify({id:result.data.id,tutor:result.data.tutor,booked:result.data.booked,students:result.data.students});
          if(fingerprint!==previous){previous=fingerprint;stableSince=Date.now();}
          if(Date.now()-stableSince>=1000)return result.data;
        } else {lastError=result?.error||lastError;previous='';stableSince=0;}
      } catch(error) {
        if(error.authentication)throw error;
        lastError=/Receiving end|Could not establish/.test(error.message)?'Waiting for Hapana’s page to load.':error.message;
      }
      await pause(500);
    }
    throw new Error(lastError);
  }
  async function collect(refs,fresh) {
    if(collecting||!refs.length)return;
    collecting=true;captureVerified=false;feedbackUI.incomplete();stopped=false;$('cancel').disabled=false;
    const retryIds=new Set(refs.map(s=>s.id)); errors=errors.filter(e=>!retryIds.has(e.ref.id));
    $('progress').hidden=false; $('progress').max=refs.length; $('progress').value=0; render();
    let position=0;
    try {
      collectorId=(await background('OPEN_COLLECTOR',{url:refs[0].url})).tabId;
      for(position=0;position<refs.length;position++) {
        const ref=refs[position];
        if(stopped)break;
        status(`Collecting class ${position+1} of ${refs.length}`,`${ref.name} · ${model.formatTime(ref.start)}. One temporary Hapana tab is reading the classes; your original tab is unchanged.`,'busy');
        try {
          if(position)await background('NAVIGATE_COLLECTOR',{url:ref.url});
          const session=await readLoaded(ref);
          const previous=sessions.find(s=>s.id===ref.id);
          sessions=sessions.filter(s=>s.id!==ref.id);sessions.push({...session,room:previous?.room||''});
        } catch(error) {
          errors.push({ref,error:error.message});
          if(error.authentication){stopped=true;position++;break;}
        }
        $('progress').value=position+1;render();
      }
      if(stopped)for(const ref of refs.slice(position))if(!errors.some(e=>e.ref.id===ref.id))errors.push({ref,error:'Not collected. Retry to complete the day.'});
    } catch(error) {
      for(const ref of refs)if(!sessions.some(s=>s.id===ref.id)&&!errors.some(e=>e.ref.id===ref.id))errors.push({ref,error:error.message});
    } finally {
      try {await background('CLOSE_COLLECTOR');}catch{}
      collectorId=null;collecting=false;collectedTime=new Date().toISOString();
      sessions=model.suggest(sessions,{preserve:!fresh});
      $('progress').hidden=true;render();
      if(errors.length)status('Some classes need another look','Verified classes are shown below. Retry failed classes before printing.','error');
      else status('The day is ready for your room choices','Names and booking counts match for every included class. Review the rooms before printing.');
      if(errors.length)scheduleUI.incomplete();
      else {
        captureVerified=true;
        savingSchedule=true;$('refresh').disabled=true;
        try {await Promise.all([scheduleUI.save(),feedbackUI.save()]);} finally {savingSchedule=false;$('refresh').disabled=false;}
      }
    }
  }
  function printSection(session,students,kind,continued=false) {
    const section=element('section','print-class');
    const header=element('header');
    header.append(element('h2','',`${model.formatTime(session.start)} – ${model.formatTime(session.end)} · ${session.name}${continued?' (continued)':''}`));
    header.append(element('div','class-subtitle',kind==='rooms'?`Tutor: ${session.tutor}`:`Room ${session.room}`));
    header.append(element('div','booked-label',`${session.booked} booked${session.booked>session.capacity?' · above Hapana capacity of '+session.capacity:''}`));
    section.append(header);
    if(!students.length){section.append(element('p','no-bookings','No students booked.'));return section;}
    const table=element('table'),cg=element('colgroup'),thead=element('thead'),tr=element('tr'),tbody=element('tbody');
    const phone=kind==='tutors'&&$('show-phone').checked, payment=kind==='tutors'&&$('show-payment').checked;
    if(kind==='tutors')cg.append(element('col','attend-col'));
    cg.append(element('col','name-col'));
    if(phone)cg.append(element('col','phone-col'));
    if(payment)cg.append(element('col','payment-col'));
    if(kind==='tutors')tr.append(element('th','','✓'));
    tr.append(element('th','','Student'));
    if(phone)tr.append(element('th','','Phone'));
    if(payment)tr.append(element('th','','Payment'));
    thead.append(tr);
    for(const student of students) {
      const row=element('tr');
      if(kind==='tutors'){const cell=element('td');const tick=element('span','tick-box');tick.setAttribute('aria-label','Attendance');cell.append(tick);row.append(cell);}
      row.append(element('td','name-cell',student.name));
      if(phone)row.append(element('td','phone-cell',student.phone||'—'));
      if(payment)row.append(element('td','payment-cell',student.payment||'—'));
      tbody.append(row);
    }
    table.append(cg,thead,tbody);section.append(table);return section;
  }
  function pageShell(group,kind,pageNumber) {
    const page=element('article','print-page'+(kind==='tutors'?' tutor-page':''));const header=element('header','page-header');
    header.append(element('div','eyebrow','SUCCESS TUTORING PARRAMATTA'),element('h1','',group.label),element('div','page-date',model.fullDate(day.date)),element('div','page-type',kind==='rooms'?'ROOM ROLL · Student-facing':'TUTOR ROLL · Staff only · All classes on one page'));
    if(demo)header.append(element('p','print-demo','DEMO — FICTIONAL SAMPLE DATA'));
    const body=element('div','page-body');const footer=element('footer','page-footer');
    const stamp=new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',timeZone:'Australia/Sydney'}).format(new Date(collectedTime||Date.now()));
    footer.append(element('span','',`Bookings read ${stamp} Sydney time · Check late changes in Hapana`),element('span','page-number',`${group.label} · ${pageNumber}`));
    page.append(header,body,footer);return {page,body};
  }
  function buildPrint(kind) {
    const blocked=model.validate(sessions,errors,collecting);if(blocked)return;
    previewKind=kind;
    document.documentElement.style.setProperty('--name-size',$('name-size').value+'pt');
    $('print-pages').replaceChildren();
    $('print-fit-notice').hidden=true;
    $('print-view').hidden=false;document.querySelector('.workspace').hidden=true;
    const kinds=kind==='all'?['rooms','tutors']:[kind];
    const denseTutors=[];
    for(const type of kinds)for(const group of model.groups(sessions,type)) {
      let pageNumber=0;
      const newPage=()=> {const next=pageShell(group,type,++pageNumber);$('print-pages').append(next.page);return next;};
      let current=newPage();
      if(type==='tutors') {
        const content=element('div','tutor-fit-content');
        for(const session of group.sessions)content.append(printSection(session,session.students,type));
        current.body.append(content);
        try {
          const fit=printFitter.fit(current.body,content);
          if(fit.effectiveFont<9)denseTutors.push(group.label);
        } catch(error) {
          $('print-pages').replaceChildren();
          status('Could not prepare tutor pages',error.message,'error');backToRooms();return;
        }
        continue;
      }
      const fits=()=>current.body.scrollHeight<=current.body.clientHeight+1;
      const placeSingleSession=session=>{
        let offset=0,continued=false;
        do {
          const remaining=session.students.slice(offset);
          let block=printSection(session,remaining,type,continued);current.body.append(block);
          if(fits()){offset=session.students.length;break;}
          block.remove();
          if(current.body.children.length){current=newPage();block=printSection(session,remaining,type,continued);current.body.append(block);if(fits()){offset=session.students.length;break;}block.remove();}
          // Split only unusually long lists; every page repeats class details.
          let accepted=0;
          for(let count=1;count<=remaining.length;count++) {
            const candidate=printSection(session,remaining.slice(0,count),type,continued);current.body.append(candidate);
            const ok=fits();candidate.remove();if(!ok)break;accepted=count;
          }
          if(!accepted)throw new Error('Choose a smaller student-name size and try again.');
          current.body.append(printSection(session,remaining.slice(0,accepted),type,continued));offset+=accepted;continued=true;
          if(offset<session.students.length)current=newPage();
        } while(offset<session.students.length);
      };
      // Keep v0.3.2-style room pagination. Only simultaneous classes in the
      // same room/time slot are treated as one block so that hour is never
      // split across two sheets. If that block is too tall on a fresh page,
      // reduce only that hour to the largest student-name size that fits.
      const slots=[];
      for(const session of group.sessions) {
        const last=slots[slots.length-1];
        if(last&&last.start===session.start)last.sessions.push(session);
        else slots.push({start:session.start,sessions:[session]});
      }
      try {
        for(const slot of slots) {
          if(slot.sessions.length===1){placeSingleSession(slot.sessions[0]);continue;}
          const content=element('div','room-hour-fit-content');
          content.style.width='100%';content.style.transformOrigin='top left';
          content.style.setProperty('--name-size',$('name-size').value+'pt');
          for(const session of slot.sessions)content.append(printSection(session,session.students,type));
          current.body.append(content);
          if(fits())continue;
          content.remove();
          if(current.body.children.length)current=newPage();
          current.body.append(content);
          if(fits())continue;
          printFitter.fitRoom(current.body,content,Number($('name-size').value));
        }
      } catch(error) {
        $('print-pages').replaceChildren();
        status('Could not prepare room pages',error.message,'error');backToRooms();return;
      }
    }
    const count=$('print-pages').children.length;
    if(denseTutors.length) {
      $('print-fit-notice').textContent=`${denseTutors.join(', ')}: a very full day has been reduced to fit one page. You can turn off phone or payment columns to give names more space.`;
      $('print-fit-notice').hidden=false;
    }
    $('preview-label').textContent=`${kind==='all'?'Room + tutor rolls':kind==='rooms'?'Room rolls':'Tutor rolls'} · ${count} A4 ${count===1?'page':'pages'}${demo?' · DEMO':''}`;
    document.title=`${demo?'DEMO-':''}Success-Tutoring-${day.date}-${kind}-rolls`;
    window.scrollTo(0,0);
  }
  function backToRooms(){ $('print-view').hidden=true;document.querySelector('.workspace').hidden=false;document.title='Daily Rolls • Success Tutoring Parramatta'; }
  function loadDemo() {
    $('demo-banner').hidden=false;
    const defs=[['7-10 English Study Hub','Alex Taylor',960,4],['K-6 Maths Study Hub','Sam Patel',960,5],['K-6 English Study Hub','Jamie Lee',960,4],['7-10 Maths Study Hub','Alex Taylor',1020,6],['K-6 English Study Hub','Sam Patel',1020,5],['K-6 Maths Study Hub','Jamie Lee',1020,4],['Selective Thinking Skills','Morgan Ellis',1080,4]];
    const names=['Avery Sample','Jordan Example','Riley Demo','Charlie Practice','Taylor Sample','Casey Example'];
    sessions=defs.map(([name,tutor,start,count],index)=>({id:'demo-'+index,date:'2026-09-14',name,tutor,start,end:start+60,booked:count,capacity:6,room:'',warnings:[],students:names.slice(0,count).map((name,i)=>({id:index+'-'+i,name,phone:'04XX XXX XXX',payment:'Sample only'}))}));
    sessions=model.suggest(sessions);
    day={date:'2026-09-14',sessions:sessions.map(s=>({...s})),excluded:[{name:'Free Student Assessment',start:960},{name:'K-6 One-on-One Session',start:1020}]};
    errors=[];collectedTime=new Date().toISOString();render();status('Explore the sample day','All names are fictional. Try assigning Selective to a room, sharing a room, and previewing the printouts.');
    $('refresh').textContent='Reset sample day';
  }
  $('refresh').addEventListener('click',start);
  $('cancel').addEventListener('click',()=>{stopped=true;$('cancel').disabled=true;status('Stopping collection…','Already verified classes will remain. Incomplete classes will need a retry.','busy');});
  $('suggest').addEventListener('click',()=>{if(confirm('Replace the current room choices with fresh suggestions?')){sessions=model.suggest(sessions);render();}});
  $('clear').addEventListener('click',()=>{if(confirm('Clear all room choices for this day?')){sessions=sessions.map(s=>({...s,room:''}));render();}});
  $('preview-rooms').addEventListener('click',()=>buildPrint('rooms'));
  $('preview-tutors').addEventListener('click',()=>buildPrint('tutors'));
  $('print-all').addEventListener('click',()=>buildPrint('all'));
  $('back').addEventListener('click',backToRooms);
  $('print').addEventListener('click',()=>window.print());
  // Browser-menu printing also rebuilds from the current verified room choices.
  window.addEventListener('beforeprint',()=>{if(!model.validate(sessions,errors,collecting))buildPrint(previewKind);else $('print-pages').replaceChildren(element('p','notice','Rolls are not ready. Finish collection and room allocation before printing.'));});
  window.addEventListener('beforeunload',event=>{if(collecting||sessions.length&&!demo){event.preventDefault();event.returnValue='';}});
  start();
})();
