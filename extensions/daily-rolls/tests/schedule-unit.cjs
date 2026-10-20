const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const model=require('../schedule-model.js')();
const stamp=n=>`2026-10-12T${String(n).padStart(2,'0')}:00:00.000Z`;
const session=(id='1',tutor='Kevin')=>({id:`2026-10-12:${id}:${id}`,date:'2026-10-12',name:'K-6 Maths',tutor,start:960,end:1020,students:[{name:'STUDENT_PRIVATE',phone:'PHONE_PRIVATE',payment:'PAYMENT_PRIVATE'}],room:'2',url:'PRIVATE_URL'});
const make=(n=1,sessions=[session()],mode='observed_sessions')=>model.capture({day:{date:'2026-10-12',sessions,excluded:[{}]},sessions,startedAt:stamp(n),completedAt:stamp(n+1),captureId:'capture_'+n,fullDay:mode==='replace_day'});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
await test('Capture contains only tutor/session fields, with no student, room or URL fields',()=>{
 const c=make();const text=JSON.stringify(c);for(const secret of ['STUDENT_PRIVATE','PHONE_PRIVATE','PAYMENT_PRIVATE','PRIVATE_URL','students','room'])assert.ok(!text.includes(secret));
 assert.deepEqual(Object.keys(c.sessions[0]),['hapanaSessionId','sessionTitle','tutorNameRaw','tutorName','startMinute','endMinute']);
});
await test('Complete capture persists independently of room allocation',()=>{const s=session();s.room='';assert.equal(make(1,[s]).sessions.length,1);});
await test('Failed, still-running and demo collections cannot be saved',()=>{
 const s=[session()],base={day:{date:'2026-10-12',sessions:s,excluded:[]},sessions:s};
 for(const extra of [{errors:[{}]},{collecting:true},{demo:true}])assert.throws(()=>model.capture({...base,...extra}));
});
await test('Missing and duplicate collected classes are rejected',()=>{
 const s=[session(),session('2')],base={day:{date:'2026-10-12',sessions:s,excluded:[]},startedAt:stamp(1),completedAt:stamp(2),captureId:'x'};
 assert.throws(()=>model.capture({...base,sessions:[s[0]]}),/match/);
 assert.throws(()=>model.capture({...base,sessions:[s[0],s[0]]}),/Duplicate/);
});
await test('Tutor substitution replaces by stable session ID with before/after history',()=>{
 const old=model.apply(null,make()).record,newer=model.apply(old,make(3,[session('1','Aryan (sub)')])).record;
 assert.equal(newer.sessions.length,1);assert.equal(newer.sessions[0].tutorName,'Aryan');
 const change=newer.revisions[1].changes[0];assert.equal(change.type,'tutor_changed');assert.equal(change.before.tutorName,'Kevin');assert.equal(change.after.tutorName,'Aryan');assert.equal(old.sessions[0].tutorName,'Kevin');
});
await test('Conservative collection keeps unseen classes and updates observed ones',()=>{
 const old=model.apply(null,make(1,[session(),session('2','Ammay')])).record;
 const r=model.apply(old,make(3,[session('1','Aryan')])).record;
 assert.equal(r.sessions.length,2);assert.equal(r.sessions[1].tutorName,'Ammay');assert.equal(r.sessions[1].observedAt,stamp(2));
});
await test('Explicit full day replacement removes disappeared classes with audit event',()=>{
 const old=model.apply(null,make(1,[session(),session('2','Ammay')])).record;
 const r=model.apply(old,make(3,[session()],'replace_day')).record;
 assert.equal(r.sessions.length,1);assert.equal(r.revisions[1].changes[0].type,'removed');
});
await test('Capture retries are idempotent and mismatched reuse is rejected',()=>{
 const c=make(),r=model.apply(null,c).record;assert.equal(model.apply(r,c).replayed,true);
 const changed=structuredClone(c);changed.sessions[0].tutorNameRaw='Aryan';assert.throws(()=>model.apply(r,changed),/reused/);
});
await test('Collection started earlier cannot overwrite a later substitution',()=>{
 const r=model.apply(null,make(3,[session('1','Aryan')])).record,c=make(1);c.completedAt=stamp(8);
 assert.throws(()=>model.apply(r,c),/newer/);assert.equal(r.sessions[0].tutorName,'Aryan');
});
await test('Same-start competing collections are rejected',()=>{const r=model.apply(null,make()).record,c=make();c.captureId='another';assert.throws(()=>model.apply(r,c),/newer/);});
await test('Other days and campuses cannot corrupt a saved day',()=>{
 const r=model.apply(null,make()).record;assert.throws(()=>model.apply({...r,date:'2026-10-13'},make(3)),/Stored/);
 const c=make();c.campusKey='other';assert.throws(()=>model.validateCapture(c),/Unsupported/);
});
await test('Malformed dates, timestamps, tutor names, duplicate IDs and times fail',()=>{
 const mutations=[c=>c.date='2026-02-30',c=>c.startedAt='2026-02-30T01:00:00.000Z',c=>c.startedAt=stamp(5),c=>c.sessions[0].hapanaSessionId='2026-10-13:1:1',c=>c.sessions[0].tutorNameRaw='(sub)',c=>c.sessions[0].tutorNameRaw='Unassigned',c=>c.sessions[0].startMinute=1020,c=>c.sessions[0].endMinute=1441,c=>c.sessions[0].startMinute=1.5,c=>c.sessions.push(c.sessions[0]),c=>c.excludedSessionCount=-1];
 for(const mutate of mutations){const c=make();mutate(c);assert.throws(()=>model.validateCapture(c));}
});
await test('An empty filtered day cannot clear a previous saved day',()=>{const c=make();c.sessions=[];assert.throws(()=>model.validateCapture(c),/empty/);});
await test('Unknown fields are discarded again at worker validation boundary',()=>{const c=make();c.student='PRIVATE';c.sessions[0].students=[{name:'PRIVATE'}];assert.ok(!JSON.stringify(model.validateCapture(c)).includes('PRIVATE'));});
await test('History is capped, labelled and revisions remain monotonic',()=>{
 let r=null;for(let i=1;i<=55;i++){const c=make();c.captureId='c'+i;c.startedAt=new Date(Date.UTC(2026,9,12,0,i)).toISOString();c.completedAt=new Date(Date.UTC(2026,9,12,0,i,30)).toISOString();r=model.apply(r,c).record;}
 assert.equal(r.revision,55);assert.equal(r.revisions.length,50);assert.equal(r.revisions[0].revision,6);assert.equal(r.historyTruncated,true);
});
await test('Storage size and input size have explicit bounds',()=>{const c=make();c.sessions=Array.from({length:501},(_,i)=>({...c.sessions[0],hapanaSessionId:`2026-10-12:${i}:${i}`}));assert.throws(()=>model.validateCapture(c),/Too many/);});
const durable={},temporary={};let handler,writes=0,failWrites=false;
const local={async get(key){await new Promise(r=>setTimeout(r,2));return{[key]:structuredClone(durable[key])};},async set(value){await new Promise(r=>setTimeout(r,2));if(failWrites)throw new Error('Storage quota exceeded');Object.assign(durable,structuredClone(value));writes++;}};
function worker(){
 const chrome={runtime:{id:'test',getURL:s=>'chrome-extension://test/'+s,onMessage:{addListener:fn=>handler=fn}},action:{onClicked:{addListener(){}}},storage:{local,session:{async get(k){return{[k]:temporary[k]};},async remove(k){delete temporary[k];}}},tabs:{onRemoved:{addListener(){}},async create(){return{id:1};}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{chrome,URL,createScheduleModel:require('../schedule-model.js'),createHapanaReader:require('../reader.js'),importScripts(){}});
}
const sender={id:'test',tab:{id:42},url:'chrome-extension://test/review.html?source=2'};
const send=(type,data={},source=sender)=>new Promise(resolve=>handler({namespace:'stp-rolls',type,...data},source,resolve));
worker();
await test('Worker rejects Hapana, fake-prefix pages and foreign extension callers',async()=>{
 for(const url of ['https://core.hapana.com/','chrome-extension://test/review.html.evil','chrome-extension://other/review.html'])assert.equal((await send('SAVE_SCHEDULE',{capture:make()},{...sender,url})).ok,false);
 assert.equal(writes,0);
});
await test('Concurrent worker saves are serialized without losing substitutions',async()=>{
 const rr=await Promise.all([send('SAVE_SCHEDULE',{capture:make()}),send('SAVE_SCHEDULE',{capture:make(3,[session('1','Aryan')])})]);
 assert.ok(rr.every(r=>r.ok));const r=await send('GET_SCHEDULE',{date:'2026-10-12'});assert.equal(r.record.revision,2);assert.equal(r.record.sessions[0].tutorName,'Aryan');
});
await test('Worker reloading preserves browser-local records',async()=>{worker();assert.equal((await send('GET_SCHEDULE',{date:'2026-10-12'})).record.sessions[0].tutorName,'Aryan');});
await test('Worker does not duplicate a revision when retrying the same save',async()=>{const n=writes,r=await send('SAVE_SCHEDULE',{capture:make(3,[session('1','Aryan')])});assert.equal(r.replayed,true);assert.equal(writes,n);});
await test('Quota failure leaves last good record intact and queue recovers',async()=>{
 failWrites=true;const c=make(5,[session('1','Moli')]),res=await send('SAVE_SCHEDULE',{capture:c});assert.equal(res.ok,false);assert.match(res.error,/quota/);
 assert.equal((await send('GET_SCHEDULE',{date:'2026-10-12'})).record.sessions[0].tutorName,'Aryan');
 failWrites=false;assert.equal((await send('SAVE_SCHEDULE',{capture:c})).ok,true);
});
await test('Worker responds clearly to invalid saved-day lookup',async()=>{assert.equal((await send('GET_SCHEDULE',{date:'invalid'})).ok,false);assert.equal((await send('GET_SCHEDULE',{date:'2026-10-13'})).record,null);});
console.log(`\n${passed} schedule tests passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
