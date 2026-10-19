// Simulated DOM + Chrome APIs. Exercises real review/controller code, not browser layout.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Node}=require('./ui-unit.cjs'),model=require('../schedule-model.js')();
const root=new Node('body'),ids={},events={},records={},requests=[];
for(const match of fs.readFileSync(path.join(__dirname,'../review.html'),'utf8').matchAll(/<([a-z-]+)[^>]*\bid="([^"]+)"[^>]*>/g)){ids[match[2]]=new Node(match[1]);ids[match[2]].id=match[2];root.append(ids[match[2]]);}
const workspace=new Node();workspace.className='workspace';root.append(workspace);
ids['name-size'].value='22';ids['show-phone'].checked=true;ids['show-payment'].checked=true;
const doc={body:root,createElement:tag=>new Node(tag),getElementById:id=>ids[id],querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),documentElement:new Node('html'),title:''};
let teacher='Kevin',visible=['1','2'],dayFailed=false,classFailed=false,storageFailed=false,portalFailed=false,clock=Date.now(),passed=0;
class FastDate extends Date{constructor(...args){super(...(args.length?args:[clock+=1000]));}static now(){return clock+=600;}}
const s=id=>({id:`2026-10-12:${id}:${id}`,date:'2026-10-12',name:'K-6 Maths',tutor:id==='1'?teacher:'Ammay',start:960,end:1020,room:'',booked:1,capacity:6,students:[{name:'PRIVATE_STUDENT',phone:'PRIVATE_PHONE',payment:'PRIVATE_PAY'}],warnings:[],url:'https://core.hapana.com/fake'});
const chrome={runtime:{id:'test',async sendMessage(message){
 requests.push(message);
 if(message.type==='BEGIN_SCHEDULE_SYNC')return{ok:true,ticket:'fixture-ticket'};
 if(message.type==='SYNC_SCHEDULE')return portalFailed?{ok:false,error:'Admin sign-in required'}:{ok:true};
 if(message.type==='OPEN_COLLECTOR')return{ok:true,tabId:9};
 if(['CLOSE_COLLECTOR','NAVIGATE_COLLECTOR'].includes(message.type))return{ok:true};
 if(message.type==='GET_SCHEDULE')return{ok:true,record:records[message.date]||null};
 if(message.type==='SAVE_SCHEDULE'){
  if(storageFailed)return{ok:false,error:'Storage quota exceeded'};
  try{const r=model.apply(records[message.capture.date],message.capture);records[message.capture.date]=r.record;return{ok:true,...r};}catch(e){return{ok:false,error:e.message};}
 }
 return{ok:false,error:'Unexpected message'};
}},tabs:{async sendMessage(tabId,message){
 if(message.type==='READ_DAY')return dayFailed?{ok:false,error:'Day not loaded'}:{ok:true,data:{date:'2026-10-12',sessions:visible.map(s),excluded:[],total:visible.length}};
 if(message.type==='READ_SESSION')return classFailed?{ok:false,login:true,error:'Sign-in expired'}:{ok:true,data:s(message.expected.id.split(':')[1])};
}}};
const sandbox={document:doc,location:{search:'?source=2'},chrome,crypto:{randomUUID:()=>`c_${clock}`},URLSearchParams,Intl,Date:FastDate,console,confirm:()=>true,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,1)),createRollModel:require('../model.js'),createScheduleModel:require('../schedule-model.js'),createHapanaReader:require('../reader.js'),createPrintFitter:require('../print-fit.js').createPrintFitter,window:{addEventListener:(type,fn)=>events[type]=fn,scrollTo(){},print(){}}};
vm.createContext(sandbox);for(const name of ['schedule-ui.js','feedback-model.js','feedback-sync-ui.js','review.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),sandbox);
async function settled(){for(let i=0;i<100;i++){if(!ids.refresh.disabled&&records['2026-10-12'])return;await new Promise(r=>setTimeout(r,2));}throw new Error('Collection did not settle');}
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
await test('Real review/controller code sends verified capture to storage and renders result',async()=>{await settled();assert.equal(records['2026-10-12'].revision,1);assert.match(ids['schedule-status'].textContent,/Saved locally and synced to the portal/);assert.match(ids['schedule-list'].textContent,/Kevin/);assert.ok(!JSON.stringify(records).includes('PRIVATE_'));});
await test('Daily rolls regeneration replaces tutor and shows before/after history',async()=>{teacher='Aryan (sub)';await ids.refresh.fire('click');assert.equal(records['2026-10-12'].revision,2);assert.match(ids['schedule-history'].textContent,/Kevin → Aryan/);assert.ok(!ids['schedule-list'].textContent.includes('Kevin'));});
await test('Conservative regeneration retains unseen classes',async()=>{visible=['1'];await ids.refresh.fire('click');assert.equal(records['2026-10-12'].sessions.length,2);assert.match(ids['schedule-status'].textContent,/unseen classes were kept/);});
await test('Full-day confirmation is captured before collection and removes missing class',async()=>{ids['schedule-full-day'].checked=true;await ids.refresh.fire('click');assert.equal(records['2026-10-12'].sessions.length,1);assert.equal(records['2026-10-12'].lastMode,'replace_day');assert.match(ids['schedule-history'].textContent,/Ammay: removed/);});
await test('Failed class preserves last record, disables printing and forbids manual save',async()=>{classFailed=true;await ids.refresh.fire('click');assert.equal(records['2026-10-12'].revision,4);assert.match(ids['schedule-status'].textContent,/incomplete/);assert.equal(ids['print-all'].disabled,true);await ids['schedule-retry'].fire('click');assert.equal(records['2026-10-12'].revision,4);assert.match(ids['schedule-status'].textContent,/not been fully verified/);});
await test('Retrying class after sign-in saves recovered schedule',async()=>{classFailed=false;await ids.errors.querySelector('button').fire('click');assert.equal(records['2026-10-12'].revision,5);assert.equal(ids['print-all'].disabled,false);});
await test('Failed day read cannot re-stamp previously shown classes through Retry saving',async()=>{dayFailed=true;await ids.refresh.fire('click');await ids['schedule-retry'].fire('click');assert.equal(records['2026-10-12'].revision,5);assert.match(ids['schedule-status'].textContent,/not been fully verified/);dayFailed=false;});
await test('Storage failure is visible, preserves saved records and permits printing',async()=>{storageFailed=true;teacher='Moli';await ids.refresh.fire('click');assert.match(ids['schedule-status'].textContent,/quota/);assert.equal(records['2026-10-12'].revision,5);assert.match(ids['schedule-list'].textContent,/Aryan/);assert.equal(ids['print-all'].disabled,false);});
await test('Retry saving recovers a storage failure without recollecting or duplication',async()=>{storageFailed=false;await ids['schedule-retry'].fire('click');assert.equal(records['2026-10-12'].revision,6);assert.match(ids['schedule-list'].textContent,/Moli/);await ids['schedule-retry'].fire('click');assert.equal(records['2026-10-12'].revision,6);});
await test('Saved-day view works independently of current collection',async()=>{ids['schedule-date'].value='2026-10-13';await ids['schedule-load'].fire('click');assert.match(ids['schedule-status'].textContent,/No tutor schedule/);assert.equal(ids['schedule-export'].disabled,true);ids['schedule-date'].value='2026-10-12';await ids['schedule-load'].fire('click');assert.match(ids['schedule-list'].textContent,/Moli/);assert.equal(ids['schedule-export'].disabled,false);});
await test('Student records stay in print view but never enter schedule messages or history',async()=>{ids['preview-tutors'].fire('click');assert.match(ids['print-pages'].textContent,/PRIVATE_STUDENT/);for(const request of requests.filter(r=>r.type==='SAVE_SCHEDULE'))assert.ok(!JSON.stringify(request).includes('PRIVATE_'));});
await test('Portal sync failure preserves the local save and can retry without duplicates',async()=>{ids.back.fire('click');portalFailed=true;await ids.refresh.fire('click');assert.equal(records['2026-10-12'].revision,7);assert.match(ids['schedule-status'].textContent,/Saved locally.*Admin sign-in required/);assert.equal(ids['print-all'].disabled,false);portalFailed=false;await ids['schedule-retry'].fire('click');assert.equal(records['2026-10-12'].revision,7);assert.match(ids['schedule-status'].textContent,/synced to the portal/);});
console.log(`\n${passed} simulated UI/collection flow tests passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
