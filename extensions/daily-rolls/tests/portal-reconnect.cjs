const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const origin='https://unified-site.successtutoringparramatta.com',alias='https://unified-test-13-2.vercel.app';
function fixture(tabs,reply) {
 let handler;const injected=[],sent=[],created=[],queries=[];
 const chrome={runtime:{id:'ours',getURL:file=>'chrome-extension://ours/'+file,onMessage:{addListener:fn=>handler=fn}},action:{onClicked:{addListener(){}}},tabs:{
  onRemoved:{addListener(){}},async query(query){queries.push(query);const patterns=Array.isArray(query.url)?query.url:[query.url];return tabs.filter(tab=>patterns.some(pattern=>tab.url.startsWith(pattern.slice(0,-1))));},
  async create(options){created.push(options);return{id:99,url:options.url};},async sendMessage(id,message){sent.push({id,message});return reply(id,message,injected);}
 },scripting:{async executeScript(options){injected.push(options);}}};
 vm.runInNewContext(source,{chrome,URL,createHapanaReader:()=>({}),createScheduleModel:()=>({}),importScripts(){},setTimeout:fn=>setTimeout(fn,0)});
 const send=(type='BEGIN_FEEDBACK_SYNC',extra={})=>new Promise(resolve=>handler({namespace:'stp-rolls',type,date:'2026-10-22',captureId:'fixture',...extra},{id:'ours',tab:{id:5},url:'chrome-extension://ours/review.html'},resolve));
 return{send,injected,sent,created,queries};
}
(async()=>{
 let f=fixture([{id:1,url:origin+'/feedback'}],(id,message,injected)=>{if(!injected.length)throw Error('Could not establish connection. Receiving end does not exist.');return{ok:true,ticket:'fixture'};});
 assert.equal((await f.send()).ok,true,'An already-open portal must reconnect after an extension update');
 assert.equal(f.injected.length,1);assert.equal(f.injected[0].target.tabId,1);assert.deepEqual(Array.from(f.injected[0].files),['portal-bridge.js']);assert.equal(f.created.length,0);
 console.log('PASS reconnects a portal tab without refreshing or navigating it');
 f=fixture([{id:2,url:alias+'/admin/feedback-schedule'}],()=>({ok:true,ticket:'alias-ticket'}));
 assert.equal((await f.send()).ticket,'alias-ticket');assert.equal(f.created.length,0);assert.equal(f.sent[0].id,2);
 console.log('PASS uses the existing explicitly supported portal alias');
 f=fixture([{id:2,url:alias+'/feedback'},{id:1,url:origin+'/feedback'}],id=>id===1?{ok:false,status:401,error:'Sign in',recollect:true}:{ok:true,ticket:'alias-admin'});
 assert.equal((await f.send()).ticket,'alias-admin');assert.equal(f.sent[0].id,1);assert.equal(f.sent.length,2);
 console.log('PASS prefers the custom portal and can use the signed-in alias when its cookie has expired');
 f=fixture([{id:1,url:origin+'/feedback'},{id:2,url:origin+'/admin/feedback-schedule'}],id=>{if(id===1)throw Error('No tab with id: 1.');return{ok:true};});
 assert.equal((await f.send()).ok,true);assert.ok(f.sent.some(item=>item.id===2));
 console.log('PASS an inaccessible first tab cannot block another portal tab');
 f=fixture([{id:1,url:origin+'/feedback'}],()=>({ok:false,error:'Newer collection already synced',status:409,recollect:true}));
 const rejected=await f.send();assert.equal(rejected.ok,false);assert.equal(rejected.recollect,true);assert.equal(f.sent.length,1);assert.equal(f.injected.length,0);
 console.log('PASS server rejection is preserved without repeating writes or replacing tickets');
 f=fixture([{id:3,url:'https://attacker.invalid/'}],()=>({ok:true}));
 assert.equal((await f.send()).ok,true);assert.equal(f.sent[0].id,99);assert.equal(f.created[0].url,origin+'/admin/feedback-schedule');
 console.log('PASS only supported portal tabs are eligible for reconnection');
})().catch(error=>{console.error(error);process.exitCode=1;});
