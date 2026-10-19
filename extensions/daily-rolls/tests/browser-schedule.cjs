// Real Chromium extension test. Hapana responses are entirely fictional and intercepted.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture,El}=require('./dom-fixture.cjs');
const extension=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'stp-rolls-test-'));
const artifacts=process.env.STP_TEST_ARTIFACTS||path.join(os.tmpdir(),'stp-rolls-artifacts');fs.mkdirSync(artifacts,{recursive:true});
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const html=e=>`<${e.tagName.toLowerCase()} ${Object.entries(e.attrs).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}>${escape(e.text)}${e.children.map(html).join('')}</${e.tagName.toLowerCase()}>`;
let tutor='Kevin',visible=['100','200'],signInWall=false,context,passed=0,portalImports=[];
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-sandbox'],viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addCookies([{name:'st_sess',value:'fixture-portal-session',url:'https://unified-test-13-2.vercel.app',httpOnly:true,secure:true,sameSite:'Lax'}]);
 await context.route('https://unified-test-13-2.vercel.app/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/admin/hapana-schedule'){
    assert.ok((route.request().headers().cookie||'').includes('st_sess=fixture-portal-session'),'The same-origin bridge must carry the HttpOnly portal session');
    const body=route.request().postDataJSON();
    if(body.action==='import_schedule')portalImports.push(body.capture);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body.action==='begin_collection'?{ok:true,ticket:'fixture-ticket'}:{ok:true})});
  }
  return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fictional portal</title><h1>Test portal only</h1>'});
 });
 await context.route('https://core.hapana.com/**',route=>{
  const url=new URL(route.request().url()),eid=url.searchParams.get('eid')||'100';
  if(signInWall&&url.searchParams.has('eid'))return route.fulfill({status:302,headers:{location:'https://core.hapana.com/login'}});
  if(url.pathname==='/login')return route.fulfill({contentType:'text/html',body:'<input type="password"><p>Sign in</p>'});
  const f=fixture({eid,tutor:eid==='100'?tutor:'Ammay'}),list=f.doc.querySelector('#getdaymyEvents');
  list.children=visible.map(id=>new El('li','',{},[new El('a','10:00 AM K-6 English Study Hub(2)',{href:fixture({eid:id}).href})]));
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Fictional Hapana test</title></head>'+html(f.doc)+'</html>'});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const extensionId=worker.url().split('/')[2];
 // Let Playwright attach routes before an extension-created tab's first navigation.
 // Both create/update remain actual Chrome APIs; all HTTPS data stays fictional.
 await worker.evaluate(()=>{
   const create=chrome.tabs.create.bind(chrome.tabs);
   chrome.tabs.create=async options=>{
     if(options.url?.startsWith('https://')){
       const tab=await create({...options,url:'about:blank'});
       await new Promise(resolve=>setTimeout(resolve,300));
       return chrome.tabs.update(tab.id,{url:options.url});
     }
     return create(options);
   };
 });
 const source=await context.newPage();await source.goto('https://core.hapana.com/index.php?route=dashboard/schedule&view=day');
 const sourceId=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://core.hapana.com/*'});return tabs.find(t=>t.url.includes('view=day')).id;});
 const review=await context.newPage(),errors=[];review.on('pageerror',e=>errors.push(e.message));review.on('dialog',d=>d.accept());
 await review.goto(`chrome-extension://${extensionId}/review.html?source=${sourceId}`);
 const saved=()=>review.waitForFunction(()=>document.getElementById('schedule-status').textContent.startsWith('Saved locally and synced to the portal')&&!document.getElementById('refresh').disabled);
 await test('Real extension collects two Hapana classes and automatically saves tutor-only schedule',async()=>{await saved();assert.equal(await review.locator('#schedule-list tbody tr').count(),2);assert.match(await review.locator('#schedule-list').innerText(),/Kevin/);});
 await test('Browser export downloads only tutor schedule and does not certify portal upload',async()=>{
  const pending=review.waitForEvent('download');await review.locator('#schedule-export').click();const download=await pending,destination=path.join(artifacts,'schedule-test-export.json');await download.saveAs(destination);
  const data=JSON.parse(fs.readFileSync(destination));assert.equal(data.portalSyncConfirmedByExport,false);assert.equal(data.day.sessions.length,2);assert.ok(!JSON.stringify(data).includes('Student Example'));assert.ok(!JSON.stringify(data).includes('04XX'));assert.equal(data.day.revision,1);assert.equal(portalImports.length,1);assert.ok(!JSON.stringify(portalImports).includes('Student Example'));
 });
 await test('Regenerating rolls changes Kevin to Aryan and records substitution history',async()=>{
  tutor='Aryan (sub)';await review.locator('#refresh').click();await saved();assert.doesNotMatch(await review.locator('#schedule-list').innerText(),/Kevin/);assert.match(await review.locator('#schedule-list').innerText(),/Aryan/);await review.getByText('Assignment history',{exact:true}).click();assert.match(await review.locator('#schedule-history').innerText(),/Kevin → Aryan/);
 });
 await test('Filtered recollection keeps unseen Ammay class',async()=>{visible=['100'];await source.reload();await review.locator('#refresh').click();await saved();assert.equal(await review.locator('#schedule-list tbody tr').count(),2);assert.match(await review.locator('#schedule-status').innerText(),/unseen classes were kept/);});
 await test('Confirming full day removes missing class and audits removal',async()=>{await review.locator('#schedule-full-day').check();await review.locator('#refresh').click();await saved();assert.equal(await review.locator('#schedule-list tbody tr').count(),1);assert.match(await review.locator('#schedule-history').innerText(),/Ammay: removed/);});
 await test('Incomplete collection preserves last durable schedule and prints no incomplete rolls',async()=>{
  signInWall=true;await review.locator('#refresh').click();await review.waitForFunction(()=>document.getElementById('status').textContent==='Some classes need another look');
  assert.match(await review.locator('#schedule-status').innerText(),/incomplete/);assert.equal(await review.locator('#schedule-list tbody tr').count(),1);assert.equal(await review.locator('#print-all').isDisabled(),true);
  const record=await worker.evaluate(async()=>{const k='stp-schedule-v1:parramatta:2026-09-12';return(await chrome.storage.local.get(k))[k];});assert.equal(record.revision,4);
 });
 await test('Retrying failed class saves recovered complete schedule',async()=>{signInWall=false;await review.locator('#errors button').click();await saved();assert.match(await review.locator('#schedule-status').innerText(),/revision 5/);});
 await test('Stored records are visible after reopening review without a Hapana source',async()=>{
  const history=await context.newPage();await history.goto(`chrome-extension://${extensionId}/review.html`);await history.locator('#schedule-date').fill('2026-09-12');await history.locator('#schedule-load').click();await history.waitForFunction(()=>document.getElementById('schedule-status').textContent.includes('revision 5'));assert.match(await history.locator('#schedule-list').innerText(),/Aryan/);await history.close();
 });
 await test('Schedule section fits desktop and mobile without page-wide overflow',async()=>{
  await review.screenshot({path:path.join(artifacts,'desktop.png'),fullPage:true});await review.setViewportSize({width:390,height:844});await review.screenshot({path:path.join(artifacts,'mobile.png'),fullPage:true});assert.ok(await review.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await review.setViewportSize({width:1440,height:1000});
 });
 await test('Room and tutor previews still render all collected students after schedule capture',async()=>{
  await review.locator('#preview-tutors').click();assert.equal(await review.locator('.tutor-page').count(),1);assert.equal(await review.locator('.name-cell').count(),2);await review.locator('#back').click();await review.locator('#preview-rooms').click();assert.equal(await review.locator('.print-class').count(),1);assert.equal(await review.locator('.name-cell').count(),2);
 });
 assert.deepEqual(errors,[],'Browser JavaScript errors');
 console.log(`\n${passed} browser scenarios passed. Screenshots: ${artifacts}`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true});});
