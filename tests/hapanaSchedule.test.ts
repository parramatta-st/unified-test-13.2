import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHapanaCapture, expectedSessions, missingClockIns } from '../lib/hapanaScheduleCore';
const raw=(name='Kevin')=>({schemaVersion:1,campusKey:'parramatta',date:'2026-10-12',timeZone:'Australia/Sydney',captureId:'capture_demo',startedAt:'2026-10-12T01:00:00.000Z',completedAt:'2026-10-12T01:01:00.000Z',mode:'replace_day',excludedSessionCount:0,sessions:[{hapanaSessionId:'2026-10-12:1:1',sessionTitle:'Maths',tutorNameRaw:name,tutorName:name,startMinute:960,endMinute:1020,students:[{name:'DO_NOT_SYNC'}]}]});
const sessions=()=>expectedSessions(validateHapanaCapture(raw(),'parramatta'));
const check=(shifts:any[]=[],now='2026-10-12T05:20:00.000Z',resolve=true)=>missingClockIns({sessions:sessions(),campusKey:'parramatta',nowMs:Date.parse(now),shifts,resolveTutor:()=>resolve?{tutorId:'kevin',tutorName:'Kevin'}:null});
const shift=(start:string,end='',extra:any={})=>({campusKey:'parramatta',tutorId:'kevin',tutorName:'Kevin',clockIn:start,clockOut:end,status:end?'completed':'active',...extra});
test('20-minute grace begins exactly at the threshold',()=>{assert.equal(check([],'2026-10-12T05:19:59Z').missing.length,0);assert.equal(check().missing.length,1);});
test('any positive overlap counts, including late arrival and early departure',()=>{
 for(const s of [shift('2026-10-12T05:30:00Z','2026-10-12T05:45:00Z'),shift('2026-10-12T04:00:00Z','2026-10-12T05:01:00Z'),shift('2026-10-12T04:00:00Z')])assert.equal(check([s],'2026-10-12T07:00:00Z').missing.length,0);
});
test('unrelated, touching, voided, wrong-campus and wrong-tutor shifts do not cover a class',()=>{
 for(const s of [shift('2026-10-12T04:00:00Z','2026-10-12T05:00:00Z'),shift('2026-10-12T06:00:00Z','2026-10-12T07:00:00Z'),shift('2026-10-12T05:00:00Z','2026-10-12T06:00:00Z',{status:'voided'}),shift('2026-10-12T05:00:00Z','2026-10-12T06:00:00Z',{campusKey:'another'}),shift('2026-10-12T05:00:00Z','2026-10-12T06:00:00Z',{tutorId:'marker'})])assert.equal(check([s],'2026-10-12T07:00:00Z').missing.length,1);
});
test('unscheduled markers never create schedule alerts and open future clocks do not count',()=>{
 const marker=shift('2026-10-12T05:00:00Z','2026-10-12T06:00:00Z',{tutorId:'marker'});
 const empty=missingClockIns({sessions:[],campusKey:'parramatta',nowMs:Date.now(),shifts:[marker],resolveTutor:()=>null});assert.equal(empty.missing.length,0);
 assert.equal(check([shift('2026-10-12T05:30:00Z')]).missing.length,1);
});
test('unmapped instructor is a mapping issue instead of an accusation',()=>{assert.equal(check([],undefined,false).missing.length,0);assert.deepEqual(check([],undefined,false).unmapped,['Kevin']);});
test('one shift covers several sessions without requiring repeated clock-ins',()=>{
 const first=sessions()[0],second={...first,sessionId:'second',startAt:'2026-10-12T06:00:00Z',endAt:'2026-10-12T07:00:00Z'};
 const r=missingClockIns({sessions:[first,second],campusKey:'parramatta',nowMs:Date.parse('2026-10-12T08:00:00Z'),shifts:[shift('2026-10-12T05:00:00Z','2026-10-12T07:00:00Z')],resolveTutor:()=>({tutorId:'kevin',tutorName:'Kevin'})});assert.equal(r.missing.length,0);
});
test('Sydney conversion follows DST, privacy whitelist strips students and substitution label normalises',()=>{
 const c=validateHapanaCapture(raw('Aryan (sub)'),'parramatta');assert.ok(!JSON.stringify(c).includes('DO_NOT_SYNC'));assert.equal(c.sessions[0].tutorName,'Aryan');assert.equal(expectedSessions(c)[0].startAt,'2026-10-12T05:00:00.000Z');
 const winter=raw();winter.date='2026-07-12';winter.sessions[0].hapanaSessionId='2026-07-12:1:1';assert.equal(expectedSessions(validateHapanaCapture(winter,'parramatta'))[0].startAt,'2026-07-12T06:00:00.000Z');
});
test('invalid date, wrong campus, duplicate session and incomplete capture are rejected',()=>{
 for(const mutate of [(r:any)=>r.date='2026-02-30',(r:any)=>r.campusKey='other',(r:any)=>r.sessions.push(r.sessions[0]),(r:any)=>r.sessions=[]]){const r=raw();mutate(r);assert.throws(()=>validateHapanaCapture(r,'parramatta'));}
});
