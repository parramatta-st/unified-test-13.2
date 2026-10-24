import crypto from 'crypto';
import { appendSheetRows, ensureSheetHeaders, readSheetRows, type SheetRow } from './googleSheets';
import { TimeClockError, timeClockSpreadsheetId, isMissingTimeClockSheetError, tutorIdFor } from './timeClock';
import { getActiveTutors } from './tutorConfig';
import { addCalendarDays } from './timeClockCore';
import { validateHapanaCapture, expectedSessions, normaliseHapanaName, type ExpectedSession } from './hapanaScheduleCore';

export const HAPANA_HEADERS = ['eventId','campusKey','date','captureId','kind','serverAt','actorName','issuedAt','payload','eventHash'] as const;
const sheetName = () => 'hapana_schedule_events';
const norm = (v: unknown) => String(v ?? '').trim();
const hash = (row: SheetRow) => crypto.createHash('sha256').update(JSON.stringify(HAPANA_HEADERS.filter(h=>h!=='eventHash').map(h=>norm(row[h])))).digest('hex');
function secret() {
  const value = (process.env.SESSION_SECRET || process.env.TUTOR_PASSWORD || '').trim();
  if (!value) throw new TimeClockError(503,'SESSION_NOT_CONFIGURED','Portal session signing is not configured.');
  return `st-hapana-capture:${value}`;
}
export function issueCollectionTicket(campusKey: string, actorName: string, date: string, captureId: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || addCalendarDays(date,0)!==date || !/^[A-Za-z0-9_-]{1,100}$/.test(captureId)) throw new TimeClockError(400,'INVALID_CAPTURE','Choose a valid date and capture ID.');
  const payload=Buffer.from(JSON.stringify({campusKey,actorName,date,captureId,issuedAt:now,expiresAt:now+2*60*60_000})).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256',secret()).update(payload).digest('base64url')}`;
}
function readTicket(token: string, campusKey: string, actorName: string, date: string, captureId: string) {
  const [payload,signature,...extra]=String(token||'').split('.');
  if (!payload || !signature || extra.length || token.length>2000) throw new TimeClockError(400,'CAPTURE_TOKEN_REQUIRED','Collect the day again to obtain a portal collection token.');
  const expected=crypto.createHmac('sha256',secret()).update(payload).digest('base64url');
  if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw new TimeClockError(403,'INVALID_CAPTURE_TOKEN','The collection token is invalid.');
  let data: any;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw new TimeClockError(400,'INVALID_CAPTURE_TOKEN','The collection token is invalid.');}
  if(data.campusKey!==campusKey||data.actorName!==actorName||data.date!==date||data.captureId!==captureId||!Number.isFinite(data.issuedAt)||!Number.isFinite(data.expiresAt)||data.issuedAt>Date.now()+5000||data.expiresAt<Date.now()) throw new TimeClockError(409,'CAPTURE_TOKEN_EXPIRED','Sign in as the same admin and collect this day again.');
  return data as {issuedAt:number};
}
export function replayScheduleEvents(rows: SheetRow[], campusKey: string) {
  const days=new Map<string,{date:string;issuedAt:number;updatedAt:string;actorName:string;mode:string;excludedSessionCount:number;sessions:ExpectedSession[]}>();
  const imports=new Map<string,{fingerprint:string;accepted:boolean}>(), mappings=new Map<string,{tutorId:string;tutorName:string}>(),warnings:string[]=[];
  const grouped=new Map<string,SheetRow[]>();
  for(const row of rows){
    if(norm(row.campusKey)!==campusKey)continue;
    if(!row.eventId||hash(row)!==row.eventHash){warnings.push('A Hapana schedule event failed its integrity check.');continue;}
    if(row.kind==='mapping'){
      try{const data=JSON.parse(row.payload);if(data.name&&data.tutorId&&data.tutorName)mappings.set(normaliseHapanaName(data.name),{tutorId:data.tutorId,tutorName:data.tutorName});else throw new Error();}catch{warnings.push('A tutor mapping is incomplete.');}
      continue;
    }
    const group=grouped.get(row.captureId)||[];group.push(row);grouped.set(row.captureId,group);
    if(row.kind!=='commit')continue;
    try{
      const meta=JSON.parse(row.payload),items=group.filter(r=>r.kind==='session'&&meta.sessionEventIds?.includes(r.eventId));
      if(items.length!==meta.count||new Set(items.map(r=>r.eventId)).size!==items.length||crypto.createHash('sha256').update(JSON.stringify(items.map(r=>r.eventHash))).digest('hex')!==meta.digest)throw new Error();
      if(imports.has(row.captureId))continue;
      const sessions=items.map(r=>JSON.parse(r.payload) as ExpectedSession);
      if(new Set(sessions.map(s=>s.sessionId)).size!==sessions.length)throw new Error();
      const previous=days.get(row.date),issuedAt=Number(row.issuedAt);
      if(!Number.isFinite(issuedAt)||!['replace_day','observed_sessions'].includes(meta.mode))throw new Error();
      const accepted=!previous||issuedAt>previous.issuedAt;
      imports.set(row.captureId,{fingerprint:meta.fingerprint,accepted});
      if(!accepted)continue;
      const merged=new Map(meta.mode==='replace_day'?[]:(previous?.sessions||[]).map(s=>[s.sessionId,s] as const));
      for(const s of sessions)merged.set(s.sessionId,s);
      days.set(row.date,{date:row.date,issuedAt,updatedAt:row.serverAt,actorName:row.actorName,mode:meta.mode,excludedSessionCount:meta.excludedSessionCount,sessions:[...merged.values()]});
    }catch{warnings.push(`Incomplete Hapana import ${row.captureId} was ignored.`);}
  }
  // Failed append attempts without a commit must never replace the last good day.
  return {days,imports,mappings,warnings};
}
export async function loadSchedule(campusKey: string) {
  let rows: SheetRow[];
  try{rows=await readSheetRows(sheetName(),timeClockSpreadsheetId());}catch(error){if(!isMissingTimeClockSheetError(error))throw error;return replayScheduleEvents([],campusKey);}
  return replayScheduleEvents(rows,campusKey);
}
function event(input: Omit<SheetRow,'eventHash'>) { const row={...input,eventId:crypto.randomUUID()};return {...row,eventHash:hash(row)}; }
export async function importSchedule(raw: unknown, ticket: string, campusKey: string, actorName: string) {
  let capture;try{capture=validateHapanaCapture(raw,campusKey);}catch(error){throw new TimeClockError(422,'INVALID_SCHEDULE',String((error as Error).message));}
  const token=readTicket(ticket,campusKey,actorName,capture.date,capture.captureId);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(capture)).digest('hex');
  const before=await loadSchedule(campusKey),prior=before.imports.get(capture.captureId);
  if(prior){if(prior.fingerprint!==fingerprint)throw new TimeClockError(409,'IDEMPOTENCY_CONFLICT','This capture ID already contains different data.');if(!prior.accepted)throw new TimeClockError(409,'STALE_CAPTURE','A newer tutor schedule is already saved. Collect again.');return {replayed:true,captureId:capture.captureId};}
  if(before.days.get(capture.date)?.issuedAt>=token.issuedAt)throw new TimeClockError(409,'STALE_CAPTURE','A newer tutor schedule is already saved. Collect again.');
  const common={campusKey,date:capture.date,captureId:capture.captureId,serverAt:new Date().toISOString(),actorName,issuedAt:String(token.issuedAt)};
  const rows=expectedSessions(capture).map(s=>event({...common,kind:'session',payload:JSON.stringify(s)}));
  const digest=crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>r.eventHash))).digest('hex');
  rows.push(event({...common,kind:'commit',payload:JSON.stringify({count:rows.length,sessionEventIds:rows.map(r=>r.eventId),digest,fingerprint,mode:capture.mode,excludedSessionCount:capture.excludedSessionCount})}));
  await ensureSheetHeaders(sheetName(),[...HAPANA_HEADERS],timeClockSpreadsheetId());
  await appendSheetRows(sheetName(),[...HAPANA_HEADERS],rows,timeClockSpreadsheetId());
  const after=await loadSchedule(campusKey),saved=after.imports.get(capture.captureId);
  if(!saved)throw new TimeClockError(503,'IMPORT_NOT_VISIBLE','Schedule upload could not be confirmed. Retry with the same collection.');
  if(!saved.accepted)throw new TimeClockError(409,'STALE_CAPTURE','A newer tutor schedule was saved during this upload. Collect again.');
  return {replayed:false,captureId:capture.captureId};
}
export async function mapHapanaTutor(name: string,tutorName: string,campusKey:string,actorName:string) {
  if(!name.trim()||name.length>180)throw new TimeClockError(400,'NAME_REQUIRED','Choose a Hapana instructor name.');
  const tutors=await getActiveTutors(campusKey),matches=tutors.filter(t=>t.tutorName===tutorName);
  if(matches.length!==1)throw new TimeClockError(422,'TUTOR_REQUIRED','Choose one active team member.');
  const tutor=matches[0];
  const row=event({campusKey,date:'',captureId:'',kind:'mapping',serverAt:new Date().toISOString(),actorName,issuedAt:'',payload:JSON.stringify({name,tutorId:tutorIdFor(campusKey,tutor.tutorName,tutor.email),tutorName:tutor.tutorName})});
  await ensureSheetHeaders(sheetName(),[...HAPANA_HEADERS],timeClockSpreadsheetId());
  await appendSheetRows(sheetName(),[...HAPANA_HEADERS],[row],timeClockSpreadsheetId());
}
