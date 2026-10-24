import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import TimeClockShiftDialog, { type EditableClockShift } from './TimeClockShiftDialog';

type Missing = {sessionId:string;date:string;tutorName:string;startAt:string;endAt:string;title:string};
type LongShift = EditableClockShift & { reviewFlags:string[]; approvedBy?:string };
type Alerts = { missing:Missing[];longShifts:LongShift[];unmapped:string[];tutors:string[];warnings:string[];todaySynced:boolean;todayFullDay:boolean;lastSync:string };
const time = (value:string) => new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',hour:'numeric',minute:'2-digit'}).format(new Date(value));
export default function TimeClockAlerts() {
  const [data,setData]=useState<Alerts|null>(null),[error,setError]=useState(''),[expanded,setExpanded]=useState(false);
  const [draft,setDraft]=useState<{mode:'create'|'approve'|'edit';tutor:string;date?:string;shift?:LongShift}|null>(null);
  const [mapping,setMapping]=useState<Record<string,string>>({}),[mappingBusy,setMappingBusy]=useState(false);
  const request=useRef<AbortController|null>(null),mounted=useRef(true);
  const load=useCallback(async()=>{
    if(request.current||document.hidden)return;
    const controller=new AbortController();request.current=controller;
    const timeout=window.setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch('/api/admin/hapana-schedule',{cache:'no-store',signal:controller.signal}),json=await response.json();
      if(!response.ok||!json.ok)throw new Error(json.error||'Could not check Time Clock alerts.');
      if(mounted.current&&request.current===controller){setData(json);setError('');}
    }catch(issue){if(mounted.current&&request.current===controller&&controller.signal.reason!=='unmounted')setError(issue instanceof Error?issue.message:'Could not check Time Clock alerts.');}
    finally{window.clearTimeout(timeout);if(request.current===controller)request.current=null;}
  },[]);
  useEffect(()=>{
    mounted.current=true;void load();
    const refresh=()=>{void load();},interval=window.setInterval(refresh,60000);
    window.addEventListener('st-time-clock-refresh',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{mounted.current=false;window.clearInterval(interval);request.current?.abort('unmounted');request.current=null;window.removeEventListener('st-time-clock-refresh',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[load]);
  async function saveMapping(name:string) {
    if(mappingBusy||!mapping[name])return;setMappingBusy(true);
    try{const response=await fetch('/api/admin/hapana-schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'map_tutor',name,tutorName:mapping[name]})}),json=await response.json();if(!response.ok||!json.ok)throw new Error(json.error||'Could not save tutor mapping.');await load();}catch(issue){setError(issue instanceof Error?issue.message:'Mapping failed.');}finally{setMappingBusy(false);}
  }
  const count=(data?.missing.length||0)+(data?.longShifts.length||0);
  return <section className="clock-alerts container" aria-label="Time Clock alerts">
    <div className="alert-title"><button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}><strong>Time Clock alerts{count?` · ${count}`:''}</strong><span>{expanded?'Hide':'View'}</span></button><Link href="/admin/time-clock" prefetch={false}>Payroll &amp; shifts</Link></div>
    {error&&<p className="alert-error" role="alert">{error} Previous alerts are retained. <button type="button" onClick={()=>void load()}>Retry</button></p>}
    {count>0&&!expanded&&<p role="status">{data?.missing.length||0} scheduled session(s) may be missing a shift · {data?.longShifts.length||0} shift(s) need duration review.</p>}
    {!!data?.unmapped.length&&!expanded&&<p>{data.unmapped.length} Hapana instructor name(s) need a portal match. Open alerts to resolve them.</p>}
    {!!data?.warnings.length&&!expanded&&<p className="alert-error" role="alert">Schedule or clock records need an integrity check. Open alerts for details.</p>}
    {data&&!data.todaySynced&&<p>No Hapana schedule has synced for today. Unscheduled marker shifts are still accepted.</p>}
    {data?.todaySynced&&!data.todayFullDay&&<p>Today’s sync covers visible classes. Confirm the full day in Daily Rolls to include removals.</p>}
    {expanded&&data&&<div className="alert-list">
      {!count&&<p>No missing clock-ins or long shifts found in the synced schedules.</p>}
      {data.missing.map(s=><article key={s.sessionId}><strong>{s.tutorName} might be missing a shift</strong><p>{s.date} · {time(s.startAt)}–{time(s.endAt)} · {s.title}</p><button className="btn" type="button" onClick={()=>setDraft({mode:'create',tutor:s.tutorName,date:s.date})}>Add missed shift</button></article>)}
      {data.longShifts.map(s=><article key={s.shiftId}><strong>{s.tutorName} · {s.clockOut?'Unusually long shift':'Potential missing clock-out'}</strong><p>Clocked in {new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'medium',timeStyle:'short'}).format(new Date(s.clockIn))}. {s.clockOut?`Clocked out ${time(s.clockOut)}. Admin approval required.`:'Still open for more than eight hours. Enter the actual finish time before approval.'}</p><button className="btn" type="button" onClick={()=>setDraft({mode:'edit',tutor:s.tutorName,shift:s})}>Correct times</button>{s.clockOut&&<button className="btn" type="button" onClick={()=>setDraft({mode:'approve',tutor:s.tutorName,shift:s})}>Approve hours</button>}</article>)}
      {data.unmapped.map(name=><article key={name}><strong>Match Hapana instructor: {name}</strong><p>Choose their portal identity before checking their scheduled shifts.</p><select className="input" aria-label={`Portal identity for ${name}`} value={mapping[name]||''} onChange={e=>setMapping(v=>({...v,[name]:e.target.value}))}><option value="">Choose team member</option>{data.tutors.map(t=><option key={t}>{t}</option>)}</select><button className="btn" type="button" disabled={mappingBusy||!mapping[name]} onClick={()=>void saveMapping(name)}>Save match</button></article>)}
      {data.warnings.map((w,i)=><p className="alert-error" key={i}>{w}</p>)}
      <p>20-minute grace for missing clock-ins. Clocking in without a scheduled class is allowed.{data.lastSync?` Last sync: ${new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',dateStyle:'short',timeStyle:'short'}).format(new Date(data.lastSync))}.`:''}</p>
    </div>}
    {draft&&<TimeClockShiftDialog mode={draft.mode} tutors={data?.tutors||[]} initialTutor={draft.tutor} initialDate={draft.date} shift={draft.shift} onClose={()=>setDraft(null)} onSaved={()=>{setDraft(null);void load();}}/>}
    <style jsx>{`
      .clock-alerts{margin-top:.7rem;margin-bottom:.7rem;padding:.8rem 1rem;border:1px solid rgba(49,200,255,.17);border-radius:14px;background:rgba(49,200,255,.04);font-size:.8rem}.alert-title{display:flex;align-items:center;justify-content:space-between;gap:1rem}.alert-title button{display:flex;align-items:center;gap:1rem;border:0;color:#eaf5ff;background:transparent;padding:0;cursor:pointer}.alert-title span,.alert-title a{color:#7dd3fc}.clock-alerts p{margin:.55rem 0;color:#afbdcf}.alert-list{display:grid;gap:.65rem;margin-top:.8rem}.alert-list article{padding:.8rem;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#10151e}.alert-list button{margin-right:.4rem}.alert-list select{max-width:260px;margin:.5rem .5rem .5rem 0}.clock-alerts .alert-error{color:#fdb5b5}button:focus-visible{outline:2px solid #7dd3fc;outline-offset:4px}
    `}</style>
  </section>;
}
