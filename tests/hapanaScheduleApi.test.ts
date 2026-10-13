import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../pages/api/admin/hapana-schedule';
import clockHandler from '../pages/api/admin/time-clock';
import { createSessionToken, SESSION_COOKIE } from '../lib/session';
import { fixtureSheets } from './helpers/timeClockSheets';
import { readSheetRows } from '../lib/googleSheets';
import { replayScheduleEvents } from '../lib/hapanaSchedule';
test('signed schedule import, substitution, mapping, retries, stale collections and marker handling through the real API and Sheets adapters',async t=>{
 const fixture=fixtureSheets(t);
 try{
  const admin=await createSessionToken({campus:'test-campus',tutor:'Demo Admin',role:'admin'}),tutor=await createSessionToken({campus:'test-campus',tutor:'Demo Tutor',role:'tutor'});
  async function request(method:string,body:any={},token=admin,route=handler){let status=200,data:any;const res={setHeader(){},status(n:number){status=n;return res;},json(j:any){data=j;return res;}};await route({method,body,query:{},headers:{cookie:`${SESSION_COOKIE}=${token}`,'content-type':'application/json'}} as any,res as any);return{status,data};}
  assert.equal((await request('GET',{},tutor)).status,403);assert.equal((await request('GET',{},'invalid')).status,401);
  const capture=(captureId:string,name='Demo Tutor',mode='replace_day')=>({schemaVersion:1,campusKey:'test-campus',date:'2026-08-31',timeZone:'Australia/Sydney',captureId,startedAt:'2026-08-31T01:00:00.000Z',completedAt:'2026-08-31T01:01:00.000Z',mode,excludedSessionCount:0,sessions:[{hapanaSessionId:'2026-08-31:1:1',sessionTitle:'Maths',tutorNameRaw:name,startMinute:960,endMinute:1020}]});
  const begin=async(id:string)=>(await request('POST',{action:'begin_collection',date:'2026-08-31',captureId:id})).data.ticket;
  const ticket1=await begin('first'),oldTicket=await begin('old');await new Promise(r=>setTimeout(r,2));
  const import1=await request('POST',{action:'import_schedule',ticket:ticket1,capture:capture('first')});assert.equal(import1.status,200);assert.equal((await request('GET')).data.missing.length,1);
  const size=fixture.sheets.get('hapana_schedule_events')!.length;
  assert.equal((await request('POST',{action:'import_schedule',ticket:ticket1,capture:capture('first')})).data.replayed,true);assert.equal(fixture.sheets.get('hapana_schedule_events')!.length,size);
  const ticket2=await begin('new');const changed=await request('POST',{action:'import_schedule',ticket:ticket2,capture:capture('new','Second Tutor (sub)')});assert.equal(changed.status,200);assert.equal((await request('GET')).data.missing[0].tutorName,'Second Tutor');
  assert.equal((await request('POST',{action:'import_schedule',ticket:oldTicket,capture:capture('old')})).status,409);
  assert.equal((await request('POST',{action:'import_schedule',ticket:ticket2+'x',capture:capture('new')})).status,403);
  const manual={action:'create_shift',requestId:'marker_manual_12345678',tutorName:'Demo Tutor',clockIn:'2026-08-31T16:00',clockOut:'2026-08-31T17:00'};
  assert.equal((await request('POST',manual,admin,clockHandler)).status,200);
  assert.equal((await request('GET')).data.missing.length,1,'Unscheduled marker shift is accepted and causes no extra alert');
  assert.equal((await request('POST',{...manual,requestId:'cover_manual_123456789',tutorName:'Second Tutor'},admin,clockHandler)).status,200);assert.equal((await request('GET')).data.missing.length,0);
  await new Promise(r=>setTimeout(r,2));const ticket3=await begin('alias');assert.equal((await request('POST',{action:'import_schedule',ticket:ticket3,capture:capture('alias','Second')})).status,200);
  assert.deepEqual((await request('GET')).data.unmapped,['Second']);assert.equal((await request('POST',{action:'map_tutor',name:'Second',tutorName:'Second Tutor'})).status,200);assert.equal((await request('GET')).data.missing.length,0);
  const rows=await readSheetRows('hapana_schedule_events','fixture-only-spreadsheet');
  const partial=rows.filter(r=>r.kind==='session');assert.equal(replayScheduleEvents(partial,'test-campus').days.size,0);
  const tampered=structuredClone(rows);tampered[0].payload='edited';assert.ok(replayScheduleEvents(tampered,'test-campus').warnings.length);
  assert.deepEqual(fixture.sheets.get('unrelated'),[['keep'],['untouched']]);
 }finally{fixture.restore();}
});
