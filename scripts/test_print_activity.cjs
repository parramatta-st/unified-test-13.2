const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
function load(file, mocks = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, require: name => { if (!(name in mocks)) throw Error('Unmocked: '+name); return mocks[name]; }, crypto: crypto.webcrypto, setTimeout, clearTimeout, AbortController, AbortSignal, process, fetch: mocks.fetch }, {filename:file});
  return exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const item = (id, extra = {}) => ({ student:'QA Student', studentId:'s1', label:'Lesson '+id, materialId:id, path:'Year 4/English/BOL/L'+id+'.pdf',
  payload:{material_id:id, qty:1,meta:{student:'QA Student'}},log:{student:'QA Student',studentId:'s1',qty:1,names:['Lesson '+id]}, ...extra });
const batch = (items, source = 'manual') => ({label:'QA worksheets',source,items});
let checks=0;
async function test(name,fn){ await fn();checks++;console.log('PASS:',name); }
(async()=>{
 const {PrintActivityQueue}=load('lib/printActivity.ts');
 await test('FIFO, active duplicate prevention, immutable selections and queued cancellation',async()=>{
   const calls=[], releases=[];
   const queue=new PrintActivityQueue(async(url,body)=>{calls.push({url,body});return new Promise(resolve=>releases.push(resolve));},()=>{});
   const original=item(1);queue.enqueue(batch([original]));
   original.payload.qty=19;original.student='Wrong Student';
   const second=queue.enqueue(batch([item(2)]));
   const cancelled=queue.enqueue(batch([item(3)]));queue.cancel(cancelled);
   assert.throws(()=>queue.enqueue(batch([item(1)])),/already queued/);
   assert.equal(calls.length,1);assert.equal(calls[0].body.qty,1);assert.equal(calls[0].body.meta.student,'QA Student');
   releases.shift()({ok:true});await tick();assert.equal(calls.length,2);assert.equal(calls[1].body.material_id,2);
   releases.shift()({ok:true});await tick();assert.equal(calls.length,2);assert.equal(queue.batches.find(x=>x.id===second).state,'sent');
 });
 await test('unknown printer response stops remaining files and never retries',async()=>{
   let calls=0;const queue=new PrintActivityQueue(async()=>{calls++;if(calls===2)throw Error('Connection lost');return{ok:true};},()=>{});
   queue.enqueue(batch([item(1),item(2),item(3)]));await tick();
   assert.equal(calls,2);assert.equal(queue.batches[0].sent,1);assert.equal(queue.batches[0].state,'attention');
   assert.match(queue.batches[0].error,/may have reached/);await tick();assert.equal(calls,2);
 });
 await test('accepted print with log failure never reprints to repair history',async()=>{
   let calls=0;const queue=new PrintActivityQueue(async()=>{calls++;return{ok:true,logWarning:'Sheets unavailable'};},()=>{});
   queue.enqueue(batch([item(1),item(2)]));await tick();
   assert.equal(calls,1);assert.equal(queue.batches[0].sent,1);assert.equal(queue.batches[0].state,'attention');
   assert.throws(()=>queue.enqueue(batch([item(1,{plannedKey:'p1'})],'automatic')),/already sent/);
 });
 await test('automatic folder preflight runs when dequeued and blocks all stale files',async()=>{
   const calls=[];const queue=new PrintActivityQueue(async(url)=>{calls.push(url);return{ok:true,blockedKeys:['p1']};},()=>{});
   queue.enqueue(batch([item(1,{plannedKey:'p1'})],'automatic'));await tick();
   assert.equal(calls.length,1);assert.match(calls[0],/folder-check-guard/);assert.equal(queue.batches[0].sent,0);assert.equal(queue.batches[0].state,'attention');
 });
 await test('automatic files recheck folders individually and carry batch/source metadata',async()=>{
   const calls=[];const queue=new PrintActivityQueue(async(url,body)=>{calls.push({url,body});return{ok:true,blockedKeys:[]};},()=>{});
   queue.enqueue(batch([item(1,{plannedKey:'p1'}),item(2,{plannedKey:'p2'})],'automatic'));await tick();
   assert.equal(calls.filter(c=>c.url.includes('folder-check-guard')).length,3);
   const prints=calls.filter(c=>c.url.includes('print-proxy'));assert.equal(prints.length,2);
   assert.equal(prints[0].body.portalLog.batchId,prints[1].body.portalLog.batchId);
   assert.equal(prints[0].body.portalLog.batchStudentSize,2);assert.equal(prints[0].body.portalLog.sourceForm,'rolling-print-queue');
 });
 await test('sign-out during preflight prevents submission',async()=>{
   let release;let prints=0;
   const queue=new PrintActivityQueue(async url=>url.includes('guard')?new Promise(resolve=>release=resolve):(prints++,{ok:true}),()=>{});
   queue.enqueue(batch([item(1,{plannedKey:'p1'})],'automatic'));queue.stop();release({ok:true,blockedKeys:[]});await tick();
   assert.equal(prints,0);assert.throws(()=>queue.enqueue(batch([item(2)])),/Sign in/);
 });
 const {studentPrintBatches}=load('lib/studentPrintHistory.ts');
 const row=(raw,other={})=>({Raw:JSON.stringify(raw),Student:raw.student||'QA Student',OK:raw.ok===false?'FALSE':'TRUE',...other});
 await test('history groups one click, separates sources and excludes other identities, campuses and failures',()=>{
   const base={when:'2026-10-19T06:00:00Z',student:'QA Student',studentId:'s1',campusKey:'epping',ok:true,batchId:'a',batchStudentSize:2,qty:1};
   const rows=[row({...base,names:['L1']}),row({...base,names:['R1']}),row({...base,batchId:'b',sourceForm:'rolling-print-queue',names:['L2']}),
     row({...base,campusKey:'parramatta',names:['Wrong campus']}),row({...base,studentId:'s2',names:['Wrong ID']}),row({...base,ok:false,names:['Failed']}),
     row({...base,student:'Another Student',studentId:'s3',names:['Wrong student']})];
   const result=studentPrintBatches(rows,'epping','s1','QA Student');assert.equal(result.length,2);
   assert.equal(result[0].names.join(','),'L1,R1');assert.equal(result[0].sent,2);assert.equal(result[1].source,'automatic');
 });
 await test('legacy print history remains readable and Sydney sheet dates have correct timestamps',()=>{
   const result=studentPrintBatches([{Timestamp:'10/19/2026 16:15:00',Student:'QA Student',OK:'TRUE',Raw:'{"names":["L3"],"qty":2}'}],'epping','s1','QA Student');
   assert.equal(result.length,1);assert.equal(result[0].ms,Date.parse('2026-10-19T05:15:00Z'));assert.equal(result[0].qty,2);
 });
 await test('history tolerates malformed legacy raw data, deduplicates receipts and identifies mixed subjects',()=>{
   const common={when:'2026-10-19T06:00:00Z',student:'QA Student',studentId:'s1',campusKey:'epping',ok:true,batchId:'mix',batchStudentSize:2};
   const first=row({...common,material_id:1,names:['L1'],year:'Year 4',subject:'English'});
   const second=row({...common,material_id:2,names:['L1'],year:'Year 4',subject:'Maths'});
   const result=studentPrintBatches([first,first,second,{Student:'Other',Raw:'null',OK:'FALSE'}],'epping','s1','QA Student');
   assert.equal(result.length,1);assert.equal(result[0].sent,2);assert.equal(result[0].folder,'Mixed worksheets');assert.match(result[0].names.join(','),/English/);assert.match(result[0].names.join(','),/Maths/);
 });
 let saved=[], logFail=false, auth={authed:true,tutor:'Verified Tutor',campus:'epping'}, serviceCalls=0;
 const handler=load('pages/api/print-proxy.ts',{
   '../../lib/auth':{getAuthStatus:async()=>auth},
   '../../lib/logs':{savePrintLog:async p=>{if(logFail)throw Error('Offline');saved.push(p);}},
   fetch:async()=>{serviceCalls++;return{ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true})};},
 }).default;
 const oldUrl=process.env.PRINT_API_URL,oldToken=process.env.PRINT_API_TOKEN;
 process.env.PRINT_API_URL='https://printer.invalid';process.env.PRINT_API_TOKEN='fictional';
 const response=()=>({statusCode:200,data:null,status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}});
 const req={method:'POST',query:{action:'print'},body:{material_id:1,qty:1,meta:{student:'QA Student'},portalLog:{tutor:'Forged',campusKey:'other',names:['L1']}}};
 await test('print API records confirmed acceptance with server-authenticated tutor and campus',async()=>{
   const res=response();await handler(req,res);assert.equal(res.statusCode,200);assert.equal(saved[0].tutor,'Verified Tutor');assert.equal(saved[0].campusKey,'epping');assert.equal(saved[0].ok,true);
 });
 await test('print API reports history failure without changing confirmed printer acceptance',async()=>{
   logFail=true;const res=response();await handler(req,res);assert.equal(res.data.ok,true);assert.match(res.data.logWarning,/accepted/);
 });
 await test('print API refuses unauthenticated and wrong-method sends before contacting Mac',async()=>{
   const before=serviceCalls;const wrong=response();await handler({...req,method:'GET'},wrong);assert.equal(wrong.statusCode,405);
   auth={authed:false};const res=response();await handler(req,res);assert.equal(res.statusCode,401);assert.equal(serviceCalls,before);
 });
 if(oldUrl===undefined)delete process.env.PRINT_API_URL;else process.env.PRINT_API_URL=oldUrl;
 if(oldToken===undefined)delete process.env.PRINT_API_TOKEN;else process.env.PRINT_API_TOKEN=oldToken;
 console.log(`${checks} print queue, history and API regression scenarios passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
