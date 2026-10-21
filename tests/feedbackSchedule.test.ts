import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackScheduleSessions, scheduleDate, scheduleTime } from '../lib/feedbackSchedule';
import { fixtureSheets } from './helpers/timeClockSheets';
import { createSessionToken } from '../lib/session';
import handler from '../pages/api/feedback-schedule';
const member={id:'s1',firstName:'Demo',lastName:'Student',parentEmail:'parent@example.invalid',parentName:'Parent',years:'',gender:'',active:true};
const row={campusKey:'test-campus',tutorName:'Demo Tutor',dayOfWeek:'Tuesday',startTime:'4pm',endTime:'5pm',studentId:'s1',studentName:'Old Name',entryType:'weekly',active:true};

test('schedule validates calendar dates and typed session times',()=>{
 assert.equal(scheduleDate('2026-02-31'),'');assert.equal(scheduleDate('2026-10-20'),'2026-10-20');
 assert.equal(scheduleTime('4:30 pm'),'16:30');assert.equal(scheduleTime('12am'),'00:00');assert.equal(scheduleTime('24:00'),'');assert.equal(scheduleTime('13pm'),'');
});
test('daily schedule uses exact centre/tutor and Member identity, independent of school year',()=>{
 const rows=[row,{...row,campusKey:'other'},{...row,tutorName:'Demo Other'},{...row,tutorName:'Demo'},{...row,active:false},{...row,startTime:'23:00',endTime:'17:00'},
  {...row,entryType:'one_off',specificDate:'2026-10-21',studentId:'s2',studentName:'Wrong Date'},
  {...row,entryType:'one_off',specificDate:'2026-10-20',studentId:'missing',studentName:'Needs Setup'}];
 const result=feedbackScheduleSessions(rows,[member],'test-campus','Demo Tutor','2026-10-20');
 assert.equal(result.length,1);assert.equal(result[0].students.length,2);
 assert.equal(result[0].students[0].name,'Demo Student');assert.equal(result[0].students[0].email,member.parentEmail);assert.equal(result[0].students[0].year,'');
 assert.equal(result[0].students[1].memberMatched,false);assert.equal(result[0].students[1].email,'');
 assert.equal(feedbackScheduleSessions([row],[member],'test-campus','Demo Tutor','2026-10-21').length,0);
});
test('schedule API authenticates, ignores supplied tutor/campus, rejects invalid dates and never writes roster',async t=>{
 const fixture=fixtureSheets(t);
 try{
  fixture.sheets.set('timetable',[Object.keys(row),Object.values(row),Object.values({...row,tutorName:'Second Tutor',studentId:'secret',studentName:'Private Student'})]);
  fixture.sheets.set('contacts',[Object.keys(member),Object.values(member)]);
  const res=()=>({code:200,body:null as any,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;},end(){return this;}});
  const unauth=res();await handler({method:'GET',query:{date:'2026-10-20'},headers:{}} as any,unauth as any);assert.equal(unauth.code,401);
  const token=await createSessionToken({tutor:'Demo Tutor',campus:'test-campus',role:'tutor'});
  const req={method:'GET',query:{date:'2026-10-20',tutor:'Second Tutor',campus:'other'},headers:{cookie:'st_sess='+token}};
  const invalid=res();await handler({...req,query:{date:'2026-02-31'}} as any,invalid as any);assert.equal(invalid.code,400);
  fixture.sheets.set('sentmsgs new',[
   ['timestamp','campusKey','studentId','studentName','sendStatus'],
   ['2026-10-20T05:00:00Z','test-campus','s1','Demo Student','sent'],
  ]);
  const actual=res();await handler(req as any,actual as any);assert.equal(actual.code,200);assert.equal(actual.body.sessions[0].students[0].name,'Demo Student');assert.equal(actual.body.sessions[0].students[0].feedbackSent,true);
  assert.ok(!JSON.stringify(actual.body).includes('Private Student'));
  const posts=(globalThis.fetch as any).mock.calls.filter((call:any)=>call.arguments[1]?.method==='POST' && !String(call.arguments[0]).includes('oauth2'));assert.equal(posts.length,0);
 }finally{fixture.restore();}
});

test('an available configured CSV roster remains usable when its optional private tab is absent',async t=>{
 const fixture=fixtureSheets(t);
 try {
  process.env.TIMETABLE_CSV_URL='https://roster.example.invalid/timetable.csv';
  fixture.sheets.set('contacts',[Object.keys(member),Object.values(member)]);
  const upstream=globalThis.fetch.bind(globalThis);
  t.mock.method(globalThis,'fetch',async(input:any,init?:RequestInit)=>{
   const url=new URL(String(input));
   if(url.hostname==='roster.example.invalid')return new Response(Object.keys(row).join(',')+'\n'+Object.values(row).join(','),{headers:{'Content-Type':'text/csv'}});
   if(decodeURIComponent(url.pathname).includes("/values/'timetable'!"))return new Response(JSON.stringify({error:{message:'Unable to parse range'}}),{status:404});
   return upstream(input,init);
  });
  const token=await createSessionToken({tutor:'Demo Tutor',campus:'test-campus'});
  const res={code:200,body:null as any,setHeader(){},status(code:number){this.code=code;return this;},json(body:any){this.body=body;return this;},end(){return this;}};
  await handler({method:'GET',query:{date:'2026-10-20'},headers:{cookie:'st_sess='+token}} as any,res as any);
  assert.equal(res.code,200);assert.equal(res.body.sessions[0].students[0].name,'Demo Student');
 } finally {fixture.restore();}
});
