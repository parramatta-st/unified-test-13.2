// Real installed extension -> signed Next API -> fake Sheets -> admin links -> tutor Feedback.
// All HTTPS pages are intercepted. No production site, real credentials or bookings are used.
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const {fixture,El}=require('../extensions/daily-rolls/tests/dom-fixture.cjs');
const PORTAL='https://unified-test-13-2.vercel.app',LOCAL='http://127.0.0.1:3115',SECRET='fictional-feedback-rolls-only',DATE='2026-09-12';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'feedback-rolls-browser-')),extension=path.resolve('extensions/daily-rolls');
const artifacts=path.resolve('qa-artifacts/feedback-rolls');fs.mkdirSync(artifacts,{recursive:true});
const contacts=[{id:'m1',firstName:'Student',lastName:'Example 1',parentName:'First Parent',parentEmail:'first@example.invalid',years:'Year 4',active:true},{id:'m2',firstName:'Canonical',lastName:'Student',parentName:'Second Parent',parentEmail:'second@example.invalid',years:'Year 5',active:true}];
const sheets=new Map([['contacts',[Object.keys(contacts[0]),...contacts.map(Object.values)]]]);
let failWrites=false,tutor='Sai Arulanathan',context,app,logs='';
const imports=[];
const fake=http.createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):{},url=new URL(req.url,'http://fixture.invalid'),pathname=decodeURIComponent(url.pathname);
 res.setHeader('Content-Type','application/json');const reply=value=>res.end(JSON.stringify(value));
 if(pathname==='/token')return reply({access_token:'fixture-only',expires_in:3600});
 if(!pathname.includes('fixture-only-spreadsheet')){res.statusCode=400;return reply({error:'Unexpected fixture spreadsheet'});}
 if(pathname.endsWith(':batchUpdate')){for(const request of body.requests){assert.equal(request.addSheet.properties.title,'feedback_roll_events');sheets.set(request.addSheet.properties.title,[]);}return reply({});}
 if(!pathname.includes('/values/'))return reply({sheets:[...sheets.keys()].map(title=>({properties:{title}}))});
 const range=pathname.split('/values/')[1],name=range.split('!')[0].replace(/^'|'$/g,'');
 if(req.method==='GET')return reply({values:sheets.get(name)||[]});
 assert.equal(name,'feedback_roll_events','Only the new feedback schedule tab may be written');
 if(failWrites){res.statusCode=503;return reply({error:{message:'Fictional write outage'}});}
 if(pathname.endsWith(':append'))sheets.set(name,[...(sheets.get(name)||[]),...body.values]);
 else if(req.method==='PUT')sheets.set(name,body.values);
 else throw Error('Unexpected fake Sheets operation');
 return reply({});
});
function token(tutorName='Demo Admin',role='admin') { const payload=Buffer.from(JSON.stringify({tutor:tutorName,campus:'parramatta',role,exp:Date.now()+3600000})).toString('base64url'),head='v1.'+payload;return head+'.'+crypto.createHmac('sha256','st-portal-session:'+SECRET).update(head).digest('base64url'); }
async function identity(name,role){await context.addCookies([{name:'st_sess',value:token(name,role),url:PORTAL,httpOnly:true,secure:true,sameSite:'Lax'}]);}
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(LOCAL+'/api/healthz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('Fictional portal did not start');}
async function localRequest(request){
 const url=new URL(request.url());
 return new Promise((resolve,reject)=>{
   const headers={host:'unified-test-13-2.vercel.app'};
   for(const key of ['cookie','content-type','origin','sec-fetch-site']){const value=request.headers()[key];if(value)headers[key]=value;}
   const req=http.request(LOCAL+url.pathname+url.search,{method:request.method(),headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const headers={...res.headers};delete headers['transfer-encoding'];delete headers.connection;resolve({status:res.statusCode,headers,body:Buffer.concat(chunks)});});});
   req.on('error',reject);req.end(request.postDataBuffer()||undefined);
 });
}
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const html=e=>`<${e.tagName.toLowerCase()} ${Object.entries(e.attrs).map(([k,v])=>`${k}="${escape(v)}"`).join(' ')}>${escape(e.text)}${e.children.map(html).join('')}</${e.tagName.toLowerCase()}>`;
(async()=>{
 await new Promise(resolve=>fake.listen(3215,'127.0.0.1',resolve));
 const env={...process.env};for(const key of Object.keys(env))if(/^(GOOGLE_|NEXT_PUBLIC_|TIMETABLE_|CONTACTS_|TIME_CLOCK_|TUTOR_CONFIG_|VERCEL_|NODE_OPTIONS)/.test(key))delete env[key];
 const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 Object.assign(env,{SESSION_SECRET:SECRET,TUTOR_PASSWORD:'fictional',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'fixture@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})}),GOOGLE_SHEETS_SPREADSHEET_ID:'fixture-only-spreadsheet',TUTOR_CONFIG_JSON:JSON.stringify(['Demo Admin','Sai','Other Tutor'].map(tutorName=>({campusKey:'parramatta',tutorName,active:true,role:tutorName==='Demo Admin'?'admin':'tutor'}))),STP_FEEDBACK_FIXTURE_ORIGIN:'http://127.0.0.1:3215',NODE_OPTIONS:'--require '+path.resolve('scripts/feedback-rolls-fixture.cjs'),NEXT_TELEMETRY_DISABLED:'1'});
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3115'],{env,stdio:['ignore','pipe','pipe']});app.stderr.on('data',chunk=>logs+=chunk);
 await ready();
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-sandbox'],viewport:{width:1440,height:1000}});
 await identity('Demo Admin','admin');
 await context.route(PORTAL+'/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/api/admin/hapana-schedule')return route.fulfill({contentType:'application/json',body:JSON.stringify(request.postDataJSON().action==='begin_collection'?{ok:true,ticket:'tutor-only-fixture'}:{ok:true})});
   if(url.pathname==='/api/time-clock')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,activeShift:null,shifts:[],history:[]})});
   if(url.pathname==='/api/inbox-unread')return route.fulfill({contentType:'application/json',body:'{"ok":true,"count":0,"unreadCount":0}'});
   if(url.pathname==='/api/admin/feedback-rolls'&&request.method()==='POST'&&request.postDataJSON().action==='import_feedback_schedule')imports.push(request.postDataJSON().capture);
   return route.fulfill(await localRequest(request));
 });
 await context.route('https://core.hapana.com/**',route=>{
   const url=new URL(route.request().url()),eid=url.searchParams.get('eid')||'100',f=fixture({eid,tutor:eid==='100'?tutor:'Other Tutor'});
   f.doc.querySelector('#getdaymyEvents').children=['100','200'].map(id=>new El('li','',{},[new El('a','10:00 AM K-6 English Study Hub(2)',{href:fixture({eid:id}).href})]));
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Fictional Hapana</title></head>'+html(f.doc)+'</html>'});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),extensionId=worker.url().split('/')[2];
 // Attach interception before tabs created by the real extension navigate.
 await worker.evaluate(()=>{const create=chrome.tabs.create.bind(chrome.tabs);chrome.tabs.create=async options=>{if(options.url?.startsWith('https://')){const tab=await create({...options,url:'about:blank'});await new Promise(r=>setTimeout(r,300));return chrome.tabs.update(tab.id,{url:options.url});}return create(options);};});
 const portal=await context.newPage(),errors=[];portal.on('pageerror',error=>errors.push(error.message));
 await portal.clock.install({time:new Date(DATE+'T03:00:00Z')});
 await portal.goto(PORTAL+'/admin/feedback-schedule');await portal.getByLabel('Saved date',{exact:true}).fill(DATE);
 await portal.getByText(/No student bookings have synced/).waitFor();
 const source=await context.newPage();await source.goto('https://core.hapana.com/index.php?route=dashboard/schedule&view=day');
 const sourceId=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://core.hapana.com/*'});return tabs.find(tab=>tab.url.includes('view=day')).id;});
 const review=await context.newPage();review.on('pageerror',error=>errors.push(error.message));review.on('dialog',dialog=>dialog.accept());await review.goto(`chrome-extension://${extensionId}/review.html?source=${sourceId}`);
 const synced=()=>review.waitForFunction(()=>document.getElementById('feedback-sync-status').textContent.startsWith('Student bookings synced to Feedback')&&!document.getElementById('refresh').disabled,{},{timeout:60000});
 await synced();
 assert.equal(imports.length,1);assert.ok(!JSON.stringify(imports).includes('04XX'));assert.ok(!JSON.stringify(imports).includes('Pending'));assert.equal(imports[0].sessions[0].students[0].id,'sample0');
 await portal.bringToFront();await portal.getByRole('button',{name:'Refresh saved day'}).click();
 await portal.getByLabel('Portal account for Sai Arulanathan',{exact:true}).waitFor();
 await portal.getByLabel('Portal account for Sai Arulanathan',{exact:true}).selectOption('Sai');await portal.getByText('Link saved. Refresh the tutor’s Feedback page to use it.').waitFor();
 await portal.getByLabel('Portal member for Student Example 2 (sample1)',{exact:true}).selectOption('m2');
 await portal.waitForFunction(()=>document.querySelector('select[aria-label="Portal member for Student Example 2 (sample1)"]')?.value==='m2'&&!document.querySelector('select').disabled);
 await portal.screenshot({path:path.join(artifacts,'admin-links-desktop.png'),fullPage:true});
 await portal.setViewportSize({width:390,height:844});await portal.screenshot({path:path.join(artifacts,'admin-links-phone.png'),fullPage:true});assert.ok(await portal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await identity('Sai','tutor');await portal.goto(PORTAL+'/feedback');await portal.getByRole('button',{name:'My schedule',exact:true}).waitFor();
 await portal.locator('.feedback-schedule-students').getByRole('button',{name:'Canonical Student',exact:true}).click();
 await portal.getByRole('button',{name:'Custom feedback',exact:true}).click();await portal.locator('textarea').first().fill('Fictional draft retained across view switches.');
 await portal.getByRole('button',{name:'All students',exact:true}).click();assert.equal(await portal.locator('textarea').first().inputValue(),'Fictional draft retained across view switches.');
 await portal.getByRole('button',{name:'My schedule',exact:true}).click();await portal.screenshot({path:path.join(artifacts,'tutor-feedback-phone.png'),fullPage:true});
 const linked=await portal.evaluate(async()=>fetch('/api/feedback-schedule?date=2026-09-12').then(response=>response.json()));assert.equal(linked.sessions[0].students.find(student=>student.id==='m2').email,'second@example.invalid');
 assert.equal((await portal.evaluate(async()=>fetch('/api/admin/feedback-rolls?date=2026-09-12').then(response=>response.status))),403);
 console.log('PASS: installed extension -> signed real API -> fake Sheets -> explicit Sai/student links -> phone Feedback and correct canonical recipient');
 await identity('Demo Admin','admin');tutor='Other Tutor';await review.locator('#schedule-full-day').check();await review.locator('#refresh').click();await synced();
 await identity('Sai','tutor');await portal.reload();await portal.getByPlaceholder('Search name or email...').waitFor();assert.equal(await portal.locator('.feedback-student-switch').count(),0);
 console.log('PASS: substitution removes Sai’s expected students and hides his switch without changing payroll');
 await identity('Demo Admin','admin');failWrites=true;await review.locator('#refresh').click();await review.getByText(/Student bookings have NOT been confirmed in Feedback/).waitFor();assert.equal(await review.locator('#print-all').isEnabled(),true);
 failWrites=false;await review.locator('#feedback-sync-retry').click();await synced();
 const before=sheets.get('feedback_roll_events').length;await review.locator('#feedback-sync-retry').click();await synced();assert.equal(sheets.get('feedback_roll_events').length,before);
 await review.screenshot({path:path.join(artifacts,'extension-sync-confirmed.png'),fullPage:true});
 const local=await worker.evaluate(async()=>chrome.storage.local.get(null));assert.ok(!JSON.stringify(local).includes('Student Example'));
 assert.deepEqual(errors,[]);console.log('PASS: failed sync keeps printing available, same-collection retry is idempotent and local tutor backups have no student data');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(context)await context.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await new Promise(resolve=>app.once('exit',resolve));}await new Promise(resolve=>fake.close(resolve));fs.rmSync(profile,{recursive:true,force:true});if(logs)console.log(logs.slice(-1500));
});
