/** Fictional print receipts and history. Tests layout stability and actual animation geometry. */
const assert=require('node:assert/strict'), fs=require('node:fs');
const {spawn}=require('node:child_process'), {chromium}=require('playwright');
const {routeApis,token,SECRET}=require('./print-browser-fixtures.cjs');
const ORIGIN='http://127.0.0.1:3117', sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fulfill=(route,json,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(json)});
const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3117'],{env:{...process.env,SESSION_SECRET:SECRET,TUTOR_PASSWORD:'fictional',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
(async()=>{
 let browser;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(ORIGIN+'/api/healthz')).ok)break;}catch{}await sleep(250);}
  browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROMIUM_PATH||chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
  fs.mkdirSync('qa-artifacts/print-motion',{recursive:true});
  for(const [width,reduced] of [[390,false],[1440,false],[320,false],[390,true]]){
   const context=await browser.newContext({viewport:{width,height:844},reducedMotion:reduced?'reduce':'no-preference'});
   await context.addCookies([{name:'st_sess',value:token(),url:ORIGIN,httpOnly:true}]);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
   await routeApis(page);
   let sent=14,historyCalls=0,inflight=0,maxInflight=0,historyFail=false,holdHistory=false,releaseHistory;
   const student={id:'motion-student',firstName:'Motion',lastName:'Student',parentEmail:'fictional@example.invalid',years:'Year 4'};
   const prints=()=>[{batchId:'fixture-batch',ms:Date.parse('2026-10-20T05:44:00Z'),timestamp:'2026-10-20T05:44:00Z',student:'Motion Student',tutor:'QA Tutor',year:'Year 4',subject:'English',topic:'BOL',folder:'BOL',names:['Lesson #1','Revision #1','Lesson #2','Revision #2'],qty:1,source:'manual',ok:true,expected:31,sent}];
   await page.route('**/api/contacts',r=>fulfill(r,{ok:true,students:[student]}));
   await page.route('**/api/student-print-history?*',async r=>{
    historyCalls++;inflight++;maxInflight=Math.max(maxInflight,inflight);
    if(holdHistory)await new Promise(resolve=>releaseHistory=resolve);else await sleep(600);
    inflight--;return historyFail?fulfill(r,{ok:false,error:'Fictional outage'},503):fulfill(r,{ok:true,prints:prints()});
   });
   await page.route('**/api/check-duplicate-print',r=>fulfill(r,{ok:true,duplicates:[]}));
   await page.route('**/api/print-proxy?*',async r=>{
    const action=new URL(r.request().url()).searchParams.get('action');
    if(action==='health')return fulfill(r,{ok:true,printer:'Fictional printer'});
    if(action==='catalog')return fulfill(r,{ok:true,items:Array.from({length:6},(_,i)=>({id:i+1,path:`Content/Year 4/English/BOL/L${i+1}.pdf`,type:'Lesson',name:`Lesson ${i+1}`,active:1}))});
    if(action==='print'){await sleep(400);sent++;return fulfill(r,{ok:true});}
    return fulfill(r,{ok:true});
   });
   await page.goto(ORIGIN+'/print');
   await page.getByPlaceholder('Search name or email...').fill('Motion');
   await page.locator('.suggest-item').filter({has:page.getByText('Motion Student',{exact:true})}).click();
   const history=page.getByRole('region',{name:'Print history for Motion Student'});
   await history.getByText('14 of 31 files confirmed sent in this batch.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Year 4',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('button',{name:'BOL',exact:true}).click();
   await page.evaluate(()=>{
    window.motionFrames=[];window.motionSampling=true;
    const sample=()=>{
     if(!window.motionSampling)return;
     const card=document.querySelector('.print-activity'),history=document.querySelector('.student-print-history');
     const rect=card?.getBoundingClientRect(),h=history?.getBoundingClientRect();
     window.motionFrames.push({t:performance.now(),y:rect?.y,height:rect?.height,historyHeight:h?.height,loading:history?.textContent.includes('Loading print history'),panels:document.querySelectorAll('.print-activity').length});
     requestAnimationFrame(sample);
    };sample();
   });
   await page.getByRole('button',{name:'Print Folder',exact:true}).click();
   await page.locator('.print-activity').waitFor();
   const positions=await page.evaluate(()=>{
    const node=document.querySelector('.print-activity'), motion=node.getAnimations()[0];
    if(!motion)return [];
    motion.pause();
    const samples=[0,250,350,450,550,650,750,850,1000].map(t=>{motion.currentTime=t;const r=node.getBoundingClientRect();return {t,y:r.y,height:r.height};});
    motion.currentTime=0;motion.play();return samples;
   });
   await page.waitForFunction(()=>!document.querySelector('.print-intro'));
   await history.getByText('20 of 31 files confirmed sent in this batch.',{exact:true}).waitFor();
   const frames=await page.evaluate(()=>{window.motionSampling=false;return window.motionFrames;});
   fs.writeFileSync(`qa-artifacts/print-motion/frames-${width}-${reduced}.json`,JSON.stringify(frames));
   assert.equal(maxInflight,1,'Refresh events never overlap or abort the request in flight');
   assert.ok(historyCalls>=2);assert.ok(!frames.some(frame=>frame.loading),'Existing history never flashes a loading placeholder');
   const heights=frames.map(f=>f.historyHeight).filter(Number.isFinite);
   assert.ok(Math.max(...heights)-Math.min(...heights)<1,'History height remains stable across every receipt');
   assert.ok(!frames.some(f=>f.panels>1),'One persistent print panel');
   if(!reduced){
    assert.equal(positions.length,9,'Actual browser animation has all sample positions');
    const first=positions[0],last=positions.at(-1);
    assert.ok(Math.abs(first.y+first.height/2-422)<6,'Notice starts at viewport centre');
    assert.ok(last.y>first.y+100,'Notice moves to bottom dock');
    assert.ok(positions.filter(f=>f.y>first.y+1&&f.y<last.y-1).length>=4,'Continuous intermediate positions');
    const steps=positions.slice(1).map((frame,i)=>frame.y-positions[i].y);
    assert.ok(Math.min(...steps)>-1,'Entrance never reverses');
    assert.ok(Math.max(...steps)<(last.y-first.y)*.7,'No single-step centre-to-bottom jump');
   }else assert.equal(positions.length,0,'Reduced motion skips the entrance');
   // A second job joins the existing dock without another centre entrance.
   await page.evaluate(()=>window.originalPrintPanel=document.querySelector('.print-activity'));
   await page.locator('.row').getByRole('button',{name:'Print',exact:true}).first().click();
   assert.equal(await page.locator('.print-intro').count(),0,'Additional jobs never restart the entrance');
   assert.ok(await page.evaluate(()=>window.originalPrintPanel===document.querySelector('.print-activity')),'The dock is not remounted');
   await history.getByText('21 of 31 files confirmed sent in this batch.',{exact:true}).waitFor();
   // Failed background reads retain the last confirmed record.
   historyFail=true;await page.evaluate(()=>dispatchEvent(new Event('st-print-history-changed')));
   await history.getByRole('button',{name:'Retry history'}).waitFor();
   await history.getByText('21 of 31 files confirmed sent in this batch.',{exact:true}).waitFor();
   historyFail=false;await history.getByRole('button',{name:'Retry history'}).click();await sleep(650);
   // A burst during a held request becomes one follow-up read, not cancellations.
   const before=historyCalls;holdHistory=true;await page.evaluate(()=>dispatchEvent(new Event('st-print-history-changed')));
   for(let i=0;i<40&&!releaseHistory;i++)await sleep(25);
   await page.evaluate(()=>{for(let i=0;i<12;i++)dispatchEvent(new Event('st-print-history-changed'));});
   assert.equal(historyCalls,before+1);holdHistory=false;releaseHistory();
   for(let i=0;i<40&&historyCalls<before+2;i++)await sleep(25);
   assert.equal(historyCalls,before+2);await sleep(650);
   await page.screenshot({path:`qa-artifacts/print-motion/${width}-${reduced?'reduced':'animated'}.png`,fullPage:true});
   assert.deepEqual(errors,[]);await context.close();
   console.log('PASS',width,reduced?'reduced motion':'smooth centre-to-dock frames','stable history, single refresh, retained receipt on outage, coalesced bursts');
  }
 }finally{if(browser)await browser.close();app.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1;});
