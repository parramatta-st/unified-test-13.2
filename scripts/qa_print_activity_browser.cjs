/** Isolated browser flows. Every external API is intercepted with fictional data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {routeApis,token,waitServer,ORIGIN,SECRET}=require('./print-browser-fixtures.cjs');
const compiled=ts.transpileModule(fs.readFileSync('lib/studentPrintHistory.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const historyExports={};vm.runInNewContext(compiled,{exports:historyExports});
const students=[{id:'qa-student-001',firstName:'QA',lastName:'Student',parentEmail:'qa-parent@example.invalid',years:'Year 4'},
 {id:'qa-student-002',firstName:'Other',lastName:'Student',parentEmail:'other-parent@example.invalid',years:'Year 4'}];
const catalog=[1,2,3].map(id=>({id,path:`Content/Year 4/English/BOL/L${id}.pdf`,type:'Lesson',name:`Lesson ${id}`,active:1}));
const fulfill=(route,json,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<100;i++){if(await check())return;await pause(50);}throw Error('Expected condition did not become true');}
async function pick(page,name){const input=page.getByPlaceholder('Search name or email...');await input.fill(name);await page.locator('.suggest-item').filter({has:page.getByText(name,{exact:true})}).click();}
async function testViewport(browser,viewport){
 const mobile=viewport.width<760,ctx=await browser.newContext({viewport});
 await ctx.addCookies([{name:'st_sess',value:token(),url:ORIGIN,httpOnly:true,sameSite:'Lax'}]);
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await routeApis(page);
 const records=[],calls=[],held=[];let hold=false,failNext=false,historyFail=false;
 await page.route('**/api/contacts',route=>fulfill(route,{ok:true,students}));
 await page.route('**/api/check-duplicate-print',route=>fulfill(route,{ok:true,duplicates:[]}));
 await page.route('**/api/student-print-history?*',route=>{
   if(historyFail)return fulfill(route,{ok:false,error:'Unavailable'},503);
   const url=new URL(route.request().url());
   return fulfill(route,{ok:true,prints:historyExports.studentPrintBatches(records,'parramatta',url.searchParams.get('studentId')||'',url.searchParams.get('studentName')||'')});
 });
 await page.route('**/api/print-proxy?*',async route=>{
   const action=new URL(route.request().url()).searchParams.get('action');
   if(action==='health')return fulfill(route,{ok:true,printer:'QA Printer',pdfStampEnabled:true,pdfStampRuntimeConfigurable:true});
   if(action==='catalog')return fulfill(route,{ok:true,items:catalog});
   if(action==='stamp-settings')return fulfill(route,{ok:true,pdfStampEnabled:route.request().postDataJSON().enabled,pdfStampRuntimeConfigurable:true});
   if(action==='print'){
     const body=route.request().postDataJSON();calls.push(body);
     if(hold)await new Promise(resolve=>held.push(resolve));
     if(failNext){failNext=false;return fulfill(route,{ok:false,error:'Connection interrupted'},502);}
     records.push({Student:body.meta.student,OK:'TRUE',Raw:JSON.stringify({...body.portalLog,when:new Date().toISOString(),campusKey:'parramatta',tutor:'QA Tutor',ok:true})});
     return fulfill(route,{ok:true});
   }
   return fulfill(route,{ok:true});
 });
 try {
  await page.goto(ORIGIN+'/feedback');
  await page.getByRole('button',{name:'My schedule',exact:true}).waitFor();
  await page.locator('.feedback-schedule-students button').first().click();
  await page.getByRole('button',{name:'Custom feedback',exact:true}).click();
  // The freeform editor is the only textarea when Custom feedback is selected.
  const editor=page.locator('textarea').first();await editor.fill('Keep this draft while changing the student search view.');
  await page.getByRole('button',{name:'All students',exact:true}).click();
  assert.equal(await editor.inputValue(),'Keep this draft while changing the student search view.');
  await page.getByPlaceholder('Search name or email...').click();
  await page.locator('.suggest-item').filter({has:page.getByText('Other Student',{exact:true})}).waitFor();
  await page.keyboard.press('Escape');
  await page.reload();await page.waitForFunction(()=>document.querySelector('.feedback-student-switch button[aria-pressed="true"]')?.textContent.includes('All students'));
  await page.getByRole('button',{name:'My schedule',exact:true}).click();
  console.log('PASS',viewport.width,'schedule/all students, full list, draft preserved, remembered mode');

  await page.getByRole('link',{name:'Print',exact:true}).click();
  await pick(page,'QA Student');
  await page.getByText('No previous printing recorded.',{exact:true}).waitFor();
  assert.equal(await page.locator('.pdf-stamp-control').count(),0);
  assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Reset selection',exact:true}).count(),1);
  await page.getByRole('button',{name:'Year 4',exact:true}).click();
  await page.getByRole('button',{name:'English',exact:true}).click();
  await page.getByRole('button',{name:'BOL',exact:true}).click();
  const printButtons=()=>page.locator('.row').getByRole('button',{name:'Print',exact:true});
  hold=true;
  await printButtons().nth(0).click();await until(()=>calls.length===1);
  await page.locator('.print-intro').waitFor({state:'detached'});
  assert.equal(await printButtons().nth(1).isEnabled(),true,'The next print remains available during a send');
  await page.getByRole('spinbutton',{name:'Copies'}).fill('2');
  await printButtons().nth(1).click();await page.locator('.print-intro').waitFor({state:'detached'});
  await until(()=>page.locator('.print-activity-heading').innerText().then(text=>text.includes('2 jobs')));
  assert.equal(calls.length,1,'Second job must wait in FIFO');
  if(mobile){assert.equal(await page.locator('.print-activity-list').count(),0);await page.locator('.print-activity-heading').click();}
  assert.equal(await page.locator('.print-activity-list article').count(),2);
  await page.locator('.print-activity-list').getByText('Lesson #2',{exact:true}).waitFor();
  await page.locator('.print-intro').waitFor({state:'detached'});
  await page.screenshot({path:`qa-artifacts/print-activity-${viewport.width}.png`,fullPage:true});
  // Use a Next Link to navigate away while the original request is unresolved.
  await page.getByRole('link',{name:'Feedback',exact:true}).click();
  await page.getByRole('button',{name:'My schedule',exact:true}).waitFor();
  assert.equal(await page.locator('.print-activity').count(),1);
  hold=false;held.shift()();await until(()=>calls.length===2);await until(()=>records.length===2);
  assert.equal(calls[0].qty,1);assert.equal(calls[1].qty,2);assert.equal(calls[1].meta.student,'QA Student');
  await page.getByText('✓ Sent to printer',{exact:true}).first().waitFor();
  await page.locator('.print-activity').waitFor({state:'detached',timeout:10000});
  console.log('PASS',viewport.width,'two queued jobs, mobile expand, FIFO, captured copies, navigation, success auto-dismiss');

  await page.getByRole('link',{name:'Print',exact:true}).click();await pick(page,'QA Student');
  const history=page.getByRole('region',{name:'Print history for QA Student'});
  // Named section has region role because it has an accessible label.
  await history.getByText('Lesson #2',{exact:true}).waitFor();
  assert.equal(await history.getByText('Lesson #1',{exact:true}).count(),0);
  await history.getByRole('button',{name:'View history'}).click();await history.getByText('Lesson #1',{exact:true}).waitFor();
  await pick(page,'Other Student');await page.getByText('No previous printing recorded.',{exact:true}).waitFor();
  historyFail=true;await pick(page,'QA Student');await page.getByRole('button',{name:'Retry history'}).waitFor();
  historyFail=false;await page.getByRole('button',{name:'Retry history'}).click();await page.getByText('Lesson #2',{exact:true}).waitFor();
  await page.screenshot({path:`qa-artifacts/print-history-${viewport.width}.png`,fullPage:true});
  console.log('PASS',viewport.width,'latest batch only, expandable history, correct student and history retry');

  // Multi-file failure: first accepted, second uncertain, third is NOT sent.
  await page.getByRole('button',{name:'Year 4',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('button',{name:'BOL',exact:true}).click();
  const before=calls.length;hold=true;
  await page.getByRole('button',{name:'Print Folder',exact:true}).click();await until(()=>held.length===1);
  held.shift()();await until(()=>held.length===1);failNext=true;hold=false;held.shift()();
  await page.locator('.print-intro').waitFor({state:'detached'});
  if(mobile)await page.locator('.print-activity-heading').click();
  await page.getByText('Needs attention',{exact:true}).waitFor();
  assert.equal(calls.length,before+2);await pause(600);assert.equal(calls.length,before+2);
  await page.getByText(/last file may have reached the printer/).waitFor();
  // A reload shows an interrupted notice; it must not replay the payload.
  const completedCalls=calls.length;await page.reload();
  await page.getByText(/Previous page session interrupted/).waitFor();assert.equal(calls.length,completedCalls);
  await page.getByRole('button',{name:'Dismiss notice'}).click();
  await page.screenshot({path:`qa-artifacts/print-simplified-${viewport.width}.png`,fullPage:true});
  console.log('PASS',viewport.width,'partial failure, no automatic retry, reload notice with no resubmission');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=5,'Horizontal overflow: '+overflow);
  assert.equal(errors.length,0,errors.join('\n'));
 } catch(error){await page.screenshot({path:`qa-artifacts/print-failure-${viewport.width}.png`,fullPage:true}).catch(()=>{});throw error;}
 finally{await ctx.close();}
}
(async()=>{
 fs.mkdirSync('qa-artifacts',{recursive:true});
 const app=spawn(process.execPath,['node_modules/next/dist/bin/next',process.env.QA_USE_BUILD === '1' ? 'start' : 'dev','-H','127.0.0.1','-p','3100'],{env:{...process.env,SESSION_SECRET:SECRET,TUTOR_PASSWORD:'qa-only-password',NEXT_PUBLIC_CAMPUSES_JSON:JSON.stringify([{id:'parramatta',name:'Epping',tutors:['QA Tutor']}]),NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 let logs='';app.stderr.on('data',chunk=>logs+=chunk);let browser;
 try{await waitServer();browser=await chromium.launch({headless:true,args:['--no-sandbox']});for(const viewport of [{width:1440,height:1000},{width:390,height:844}])await testViewport(browser,viewport);console.log('PRINT ACTIVITY BROWSER FLOWS PASSED');}
 finally{if(browser)await browser.close();app.kill('SIGTERM');if(logs)console.log(logs.slice(-2500));}
})().catch(error=>{console.error(error);process.exitCode=1;});
