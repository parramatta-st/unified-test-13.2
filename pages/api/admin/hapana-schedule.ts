import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../lib/adminAuth';
import { getActiveTutors } from '../../../lib/tutorConfig';
import { loadTimeClockState, TimeClockError, timeClockConfigured, tutorIdFor } from '../../../lib/timeClock';
import { loadSchedule, issueCollectionTicket, importSchedule, mapHapanaTutor } from '../../../lib/hapanaSchedule';
import { missingClockIns, normaliseHapanaName } from '../../../lib/hapanaScheduleCore';
import { sydneyDateKey } from '../../../lib/timeClockCore';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
export default async function handler(req: NextApiRequest,res: NextApiResponse) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  const admin=await requireAdmin(req);
  if(!admin.authed)return res.status(401).json({ok:false,error:'Sign in to the portal as an admin, then retry syncing the rolls.'});
  if(!admin.isAdmin)return res.status(403).json({ok:false,error:'Only an admin can sync and review tutor schedules.'});
  if(!['GET','POST'].includes(req.method||'')){res.setHeader('Allow','GET, POST');return res.status(405).json({ok:false,error:'Method not allowed.'});}
  try {
    if(!timeClockConfigured().sheets)throw new TimeClockError(503,'STORAGE_NOT_CONFIGURED','Time Clock storage is not configured.');
    if(req.method==='POST') {
      if(!String(req.headers['content-type']||'').toLowerCase().includes('application/json'))throw new TimeClockError(415,'JSON_REQUIRED','Send the schedule as JSON.');
      if(req.headers['sec-fetch-site']==='cross-site')throw new TimeClockError(403,'SAME_ORIGIN_REQUIRED','Sync from the signed-in portal.');
      const body=req.body||{};
      if(body.action==='begin_collection')return res.status(200).json({ok:true,ticket:issueCollectionTicket(admin.campus,admin.tutor,String(body.date||''),String(body.captureId||''))});
      if(body.action==='import_schedule')return res.status(200).json({ok:true,...await importSchedule(body.capture,String(body.ticket||''),admin.campus,admin.tutor),message:'Tutor schedule synced to the portal.'});
      if(body.action==='map_tutor') {await mapHapanaTutor(String(body.name||''),String(body.tutorName||''),admin.campus,admin.tutor);return res.status(200).json({ok:true});}
      throw new TimeClockError(400,'UNKNOWN_ACTION','Unknown schedule action.');
    }
    const [schedule,state,tutors]=await Promise.all([loadSchedule(admin.campus),loadTimeClockState(),getActiveTutors(admin.campus)]);
    const resolveTutor=(name:string)=>{
      const key=normaliseHapanaName(name),mapped=schedule.mappings.get(key);
      if(mapped){const active=tutors.find(t=>tutorIdFor(admin.campus,t.tutorName,t.email)===mapped.tutorId);return active?{tutorId:mapped.tutorId,tutorName:active.tutorName}:null;}
      const matches=tutors.filter(t=>normaliseHapanaName(t.tutorName)===key);
      return matches.length===1?{tutorId:tutorIdFor(admin.campus,matches[0].tutorName,matches[0].email),tutorName:matches[0].tutorName}:null;
    };
    const sessions=[...schedule.days.values()].flatMap(d=>d.sessions),nowMs=Date.now();
    const checked=missingClockIns({sessions,campusKey:admin.campus,nowMs,resolveTutor,shifts:state.shifts});
    const today=sydneyDateKey(nowMs),todayRecord=schedule.days.get(today);
    return res.status(200).json({ok:true,
      missing:schedule.warnings.length?[]:checked.missing,
      unmapped:[...new Set(sessions.filter(s=>!resolveTutor(s.tutorNameRaw)).map(s=>s.tutorNameRaw))],
      longShifts:state.shifts.filter(s=>s.campusKey.toLowerCase()===admin.campus.toLowerCase()&&s.reviewFlags.some(f=>['long_shift','open_over_limit'].includes(f))),
      tutors:tutors.map(t=>t.tutorName),
      warnings:[...schedule.warnings,...state.integrityWarnings],
      today, todaySynced:!!todayRecord, todayFullDay:todayRecord?.mode==='replace_day',
      lastSync:[...schedule.days.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.updatedAt||'',
      days:[...schedule.days.values()].map(d=>({date:d.date,updatedAt:d.updatedAt,mode:d.mode,classes:d.sessions.length,excluded:d.excludedSessionCount})),
    });
  }catch(error){
    const issue=error as Error;
    return res.status(error instanceof TimeClockError?error.status:500).json({ok:false,code:error instanceof TimeClockError?error.code:'SCHEDULE_ERROR',error:issue.message||'Could not check tutor schedules.'});
  }
}
