/** Fictional roster + send receipts only; no parent emails or production services are contacted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');
const {routeApis, token, SECRET} = require('./print-browser-fixtures.cjs');
const ORIGIN = 'http://127.0.0.1:3116';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3116'], {
 env: {...process.env, SESSION_SECRET:SECRET, TUTOR_PASSWORD:'fictional', TUTOR_NAMES:'QA Tutor', NEXT_TELEMETRY_DISABLED:'1'}, stdio:'ignore'
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reply = (route, body, status=200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(body)});
(async () => {
 let browser;
 try {
  for (let i=0;i<80;i++) { try { if ((await fetch(ORIGIN+'/api/healthz')).ok) break; } catch {} await sleep(250); }
  const executablePath = process.env.QA_CHROMIUM_PATH || (process.env.QA_SPARTICUZ ? await (await import(process.env.QA_SPARTICUZ)).default.executablePath() : chromium.executablePath());
  browser = await chromium.launch({headless:true, executablePath, args:['--no-sandbox','--disable-dev-shm-usage']});
  fs.mkdirSync('qa-artifacts/feedback-sent', {recursive:true});
  for (const width of [390,1440,320]) {
   const context = await browser.newContext({viewport:{width,height:900}, reducedMotion:'reduce'});
   await context.addCookies([{name:'st_sess', value:token(), url:ORIGIN, httpOnly:true}]);
   const page = await context.newPage(), errors=[];
   page.on('pageerror', error=>errors.push(error.message));
   page.on('dialog', dialog=>dialog.accept());
   await routeApis(page);
   let sent=false, fail=false, sends=0, originalDate='';
   await page.route('**/api/feedback-schedule?*', route=>{
    const date = new URL(route.request().url()).searchParams.get('date'); originalDate ||= date;
    const students = ['Already Sent','New Student'].map((name,index)=>({id:'s'+index, name, firstName:name.split(' ')[0], lastName:name.split(' ')[1], email:'parent'+index+'@example.invalid', parentName:'Parent', memberMatched:true, feedbackSent:date===originalDate && (index===0 || sent)}));
    return reply(route,{ok:true,configured:true,sessions:[0,1].map(index=>({key:String(index),startLabel:`${4+index}:00pm`,endLabel:`${5+index}:00pm`,students}))});
   });
   await page.route('**/api/check-duplicate-feedback', route=>reply(route,{ok:true,duplicates:[]}));
   await page.route('**/api/send-feedback', route=>{ sends++; if(fail)return reply(route,{ok:false,error:'Fictional send failure'},500); sent=true; return reply(route,{ok:true}); });
   await page.goto(ORIGIN+'/feedback');
   const already=page.locator('.feedback-schedule-students .feedback-sent'); await already.first().waitFor();
   assert.equal(await already.count(),2);
   assert.equal(await already.first().isEnabled(),true);
   await already.first().click();
   assert.equal(await already.first().getAttribute('aria-pressed'),'true');
   assert.equal(await already.first().evaluate(el=>getComputedStyle(el).borderColor),'rgb(96, 165, 250)');
   const fresh=page.locator('.feedback-schedule-students button').filter({hasText:'New Student'});
   await fresh.first().click(); await page.getByRole('button',{name:'Custom feedback',exact:true}).click();
   await page.locator('textarea').first().fill('A fictional feedback message.');
   const send=page.getByRole('button',{name:'Send to Parent',exact:true});
   if(width===390){
    await send.click(); assert.equal(await already.count(),2);
    await page.getByRole('button',{name:/Undo/}).click(); await sleep(5100);
    assert.equal(sends,0); assert.equal(await already.count(),2);
    fail=true;
    await send.click(); await page.waitForResponse(r=>r.url().endsWith('/api/send-feedback'));
    await send.waitFor({state:'visible'}); await sleep(150);
    assert.equal(sends,1); assert.equal(await already.count(),2);
    fail=false;
    await send.click();
    // Selection can change during the delay; only the captured recipient is marked.
    await page.locator('.feedback-schedule-students button').filter({hasText:'Already Sent'}).first().click();
    await page.waitForResponse(r=>r.url().endsWith('/api/send-feedback'));
    await fresh.first().locator('xpath=self::*[contains(@class,"feedback-sent")]').waitFor();
    assert.equal(await already.count(),4);
    await fresh.first().click(); await send.click();
    await page.waitForResponse(r=>r.url().endsWith('/api/send-feedback'));
    assert.equal(sends,3,'Repeat feedback remains sendable');
    await page.reload(); await page.locator('.feedback-sent').nth(3).waitFor();
    await page.getByLabel('Schedule date').fill('2026-10-21'===originalDate?'2026-10-22':'2026-10-21');
    await page.waitForFunction(()=>!document.querySelector('.feedback-sent'));
    await page.getByRole('button',{name:'Today',exact:true}).click(); await page.locator('.feedback-sent').nth(3).waitFor();
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
   await page.screenshot({path:`qa-artifacts/feedback-sent/${width}.png`,fullPage:true});
   assert.deepEqual(errors,[]); await context.close();
   console.log('PASS',width,'blue day markers, selection, usable buttons, no overflow',width===390?'plus Undo, failure, captured recipient, repeat send, reload and date isolation':'');
  }
 } finally { if(browser)await browser.close();app.kill('SIGTERM'); }
})().catch(error=>{console.error(error);process.exitCode=1;});
