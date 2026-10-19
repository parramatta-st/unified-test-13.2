const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../portal-bridge.js'),'utf8');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
 let listener,calls=[],response={ok:true,ticket:'signed-fixture'},responseOK=true;
 const context={location:{origin:'https://unified-test-13-2.vercel.app'},chrome:{runtime:{id:'ours',onMessage:{addListener:fn=>listener=fn}}},AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push({url,options});return{ok:responseOK,json:async()=>response};}};
 vm.runInNewContext(source,context);
 const send=(body,sender={id:'ours'})=>new Promise(resolve=>listener({namespace:'stp-rolls',type:'PORTAL_SCHEDULE_REQUEST',body},sender,resolve));
 await test('Bridge is inactive on every other origin',()=>{let registered=false;vm.runInNewContext(source,{location:{origin:'https://attacker.invalid'},chrome:{runtime:{onMessage:{addListener(){registered=true;}}}}});assert.equal(registered,false);});
 await test('Foreign extensions and unrelated messages cannot trigger a request',()=>{assert.equal(listener({namespace:'stp-rolls',type:'PORTAL_SCHEDULE_REQUEST',body:{action:'begin_collection'}},{id:'other'},()=>{}),undefined);assert.equal(calls.length,0);});
 await test('Only collection-start and schedule-import actions are accepted',async()=>{const result=await send({action:'void_shift'});assert.equal(result.ok,false);assert.equal(calls.length,0);});
 await test('Bridge calls only the same-origin schedule endpoint using the existing portal session',async()=>{const result=await send({action:'begin_collection',date:'2026-10-13',captureId:'fixture'});assert.equal(result.ticket,'signed-fixture');assert.equal(calls[0].url,'/api/admin/hapana-schedule');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.method,'POST');assert.equal(JSON.parse(calls[0].options.body).action,'begin_collection');});
 await test('Sign-in/server errors are returned clearly without claiming a sync',async()=>{responseOK=false;response={ok:false,error:'Admin sign-in required'};const result=await send({action:'import_schedule',capture:{}});assert.equal(result.ok,false);assert.equal(result.error,'Admin sign-in required');});
 console.log(`\n${passed} portal bridge tests passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
