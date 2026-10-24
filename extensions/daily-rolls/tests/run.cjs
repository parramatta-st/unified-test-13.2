const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const reader=require('../reader.js')(),model=require('../model.js')();
const {fixture,El}=require('./dom-fixture.cjs');
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
(async()=>{
await test('Parses dates without browser timezone drift',()=>{assert.equal(reader.dateFromHeading('Saturday, September 12, 2026'),'2026-09-12');assert.equal(reader.dateFromHeading('Sep 7 - 13, 2026'),null);assert.equal(reader.validDate('2026-02-30'),false);});
await test('Midday and midnight parsing',()=>{assert.equal(reader.timeMinutes('12:00 AM'),0);assert.equal(reader.timeMinutes('12:00 PM'),720);assert.equal(reader.timeMinutes('4:30 PM'),990);assert.equal(reader.timeMinutes('13:00 PM'),null);assert.equal(model.formatTime(720),'12:00 pm');});
await test('Excludes assessment spelling variants and one-to-one',()=>{for(const name of ['Free Student Asssesment','Free Student Assessment','Diagnostic','K-6 One-on-One Session','1:1','1-on-1','One to One'])assert.equal(reader.excluded(name),true,name);for(const name of ['7-10 Maths','K-6 English','Selective','OC Reading'])assert.equal(reader.excluded(name),false,name);});
await test('Session links are origin/route/date restricted',()=>{const {href}=fixture();assert.ok(reader.sessionRef(href));assert.equal(reader.sessionRef(href.replace('core.hapana.com','attacker.example')),null);assert.equal(reader.sessionRef(href.replace('dashboard/schedule','dashboard/delete')),null);assert.equal(reader.sessionRef(href.replace('curr=2026-09-12','curr=2026-09-13')),null);assert.ok(!reader.sessionRef(href+'&token=secret&action=delete').url.includes('token'));});
await test('Extracts a synthetic day and full class',()=>{const {doc,href}=fixture();const day=reader.readDay(doc,href);assert.equal(day.sessions.length,1);assert.equal(day.sessions[0].name,'K-6 English Study Hub');const s=reader.readSession(doc,href,day.sessions[0]);assert.equal(s.students.length,2);assert.equal(s.tutor,'Tutor Example');assert.equal(s.students[0].phone,'04XX XXX XXX');assert.equal(s.students[0].payment,'Pending');});
await test('Desktop/mobile duplicate rows are not double counted',()=>{const {doc,href}=fixture({rows:6,count:6,mobile:true});const day=reader.readDay(doc,href);assert.equal(reader.readSession(doc,href,day.sessions[0]).students.length,6);});
await test('Different client IDs with identical names remain separate',()=>{const {doc,href}=fixture({sameName:true});const ref=reader.readDay(doc,href).sessions[0];assert.equal(reader.readSession(doc,href,ref).students.length,2);});
await test('Partial lists block a roll',()=>{const {doc,href}=fixture({count:6,rows:5});const ref=reader.readDay(doc,href).sessions[0];assert.throws(()=>reader.readSession(doc,href,ref),/Incomplete student list/);});
for(const [name,fn] of require('./late-cancel.cjs'))await test(name,fn);
await test('Empty class requires a loaded zero-booking list',()=>{const {doc,href}=fixture({count:0,rows:0});const ref=reader.readDay(doc,href).sessions[0];assert.equal(reader.readSession(doc,href,ref).booked,0);});
await test('Seven bookings in capacity six is allowed with warning',()=>{const {doc,href}=fixture({count:7,rows:7});const ref=reader.readDay(doc,href).sessions[0];assert.match(reader.readSession(doc,href,ref).warnings[0],/7 booked/);});
await test('Wrong date, session or campus cannot be accepted',()=>{const {doc,href}=fixture();const ref=reader.readDay(doc,href).sessions[0];assert.throws(()=>reader.readSession(doc,href,{...ref,id:'wrong'}));assert.throws(()=>reader.readSession(doc,href,{...ref,date:'2026-09-13'}));const other=fixture({campus:'Other campus'});assert.throws(()=>reader.readSession(other.doc,other.href,reader.readDay(other.doc,other.href).sessions[0]),/Parramatta/);});
await test('Same-name simultaneous sessions retain separate IDs',()=>{const {doc,href}=fixture();const list=doc.querySelector('#getdaymyEvents');list.children.push(new El('li','',{},[new El('a','10:00 AM K-6 English Study Hub(2)',{href:href.replace('seid=100','seid=101').replace('eid=100','eid=101')})]));const day=reader.readDay(doc,href);assert.equal(day.sessions.length,2);assert.notEqual(day.sessions[0].id,day.sessions[1].id);});
await test('Loading and stale calendar lists block collection',()=>{const {doc,href}=fixture({date:'2026-09-13'});assert.throws(()=>reader.readDay(doc,href),/disagree/);const other=fixture();other.doc.querySelector('#getdaymyEvents').text='Loading ...';assert.throws(()=>reader.readDay(other.doc,other.href),/still loading/);});
const classes=[{id:'a',name:'7-10 English',start:960,end:1020,tutor:'A'},{id:'b',name:'K-6 English',start:960,end:1020,tutor:'B'},{id:'c',name:'K-6 Math',start:960,end:1020,tutor:'C'},{id:'d',name:'K-6 English',start:960,end:1020,tutor:'D'},{id:'e',name:'K-6 Math',start:960,end:1020,tutor:'E'},{id:'f',name:'Selective',start:1020,end:1140,tutor:'F'}];
await test('Senior defaults and primary-room suggestions allow sharing',()=>{const suggested=model.suggest(classes);assert.equal(suggested[0].room,'1');assert.deepEqual(suggested.slice(1,5).map(s=>s.room),['2','3','4','2']);assert.equal(suggested[5].room,'');assert.equal(classes[0].room,undefined);});
await test('Primary rooms prioritise larger same-time classes as Room 2 >= Room 3 >= Room 4',()=>{const sameTime=[10,9,8,7,6,5].map((booked,i)=>({id:'p'+i,name:'K-6 Study Hub',start:960,end:1020,booked}));const suggested=model.suggest(sameTime);const totals=Object.fromEntries(['2','3','4'].map(room=>[room,suggested.filter(s=>s.room===room).reduce((n,s)=>n+s.booked,0)]));assert.deepEqual(totals,{'2':17,'3':15,'4':13});assert.ok(totals['2']>=totals['3']&&totals['3']>=totals['4']);});
await test('Shared overlapping rooms never block printing',()=>{const shared=classes.map(s=>({...s,room:'1'}));assert.equal(model.validate(shared,[],false),'');assert.equal(model.groups(shared,'rooms')[0].sessions.length,6);});
await test('Unassigned, incomplete or running days cannot print',()=>{assert.match(model.validate(classes,[],false),/Choose a room/);assert.match(model.validate([],[],false),/No included/);assert.match(model.validate([],[{}],false),/errors/);assert.match(model.validate([],[],true),/still running/);});
await test('Boundary-adjacent classes are not overlapping',()=>{assert.equal(model.overlap({start:960,end:1020},{start:1020,end:1080}),false);assert.equal(model.overlap({start:960,end:1021},{start:1020,end:1080}),true);});
for(const [name,fn] of require('./room-allocation.cjs'))await test(name,fn);
await test('Tutors and rooms group independently',()=>{const list=classes.map(s=>({...s,room:'2'}));assert.equal(model.groups(list,'rooms').length,1);assert.equal(model.groups(list,'tutors').length,6);});
await test('Manifest limits reconnection to existing Hapana and portal hosts',()=>{const m=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json')));assert.equal(m.manifest_version,3);assert.deepEqual(m.permissions,['storage','scripting']);assert.deepEqual(m.host_permissions,['https://core.hapana.com/*','https://unified-site.successtutoringparramatta.com/*','https://unified-test-13-2.vercel.app/*']);});
await test('No network calls in collection/printing, safe HTML construction and isolated durable storage',()=>{for(const name of ['reader.js','model.js','content.js','background.js','review.js','schedule-model.js','schedule-ui.js','print-fit.js','launcher.js']){const source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');assert.ok(!/\bfetch\s*\(|XMLHttpRequest|innerHTML\s*=|insertAdjacentHTML|document\.cookie|chrome\.cookies|localStorage|storage\.sync/.test(source),name);if(name!=='background.js')assert.ok(!/storage\.local/.test(source),name);new vm.Script(source,{filename:name});}});
await test('Worker rejects untrusted callers and cleans only owned tabs',async()=>{
  const storage={},created=[],removed=[];let handler;let onRemoved;let seq=700;
  const chrome={runtime:{id:'testid',getURL:s=>'chrome-extension://testid/'+s,onMessage:{addListener:fn=>handler=fn}},action:{onClicked:{addListener(){}}},storage:{session:{async get(key){return{[key]:storage[key]};},async set(o){Object.assign(storage,o);},async remove(key){delete storage[key];}}},tabs:{async create(o){created.push(o);return{id:++seq};},async remove(id){removed.push(id);},async update(id,o){return{id,...o};},onRemoved:{addListener:fn=>onRemoved=fn}}};
  const sandbox={chrome,URL,createHapanaReader:require('../reader.js'),createScheduleModel:require('../schedule-model.js'),importScripts(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),sandbox);
  const send=(type,sender,data={})=>new Promise(resolve=>handler({namespace:'stp-rolls',type,...data},sender,resolve));
  const sender={id:'testid',tab:{id:42},url:'chrome-extension://testid/review.html?source=12'};
  let res=await send('OPEN_COLLECTOR',{id:'testid',tab:{id:12},url:'https://core.hapana.com/'},{url:fixture().href});assert.equal(res.ok,false);
  res=await send('OPEN_COLLECTOR',sender,{url:fixture().href});assert.equal(res.ok,true);assert.equal(created[0].active,false);
  const owned=res.tabId;res=await send('NAVIGATE_COLLECTOR',sender,{url:'https://attacker.example/'});assert.equal(res.ok,false);
  await onRemoved(999);assert.equal(removed.length,0);await onRemoved(42);assert.deepEqual(removed,[owned]);assert.equal(storage['collector:42'],undefined);
});
await test('Non-rendering review events: shared rooms, privacy, toggles, clear/suggest and print rebuild',require('./ui-unit.cjs'));
const fitter=require('../print-fit.js').createPrintFitter();
await test('Tutor fit preserves normal size and contains dense or wide content',()=>{
  assert.equal(fitter.fitScale(700,500,704,900),1);
  for(const [width,height] of [[700,1200],[950,1500],[700,6000],[1200,400]]) {
    const scale=fitter.fitScale(width,height,704,900);
    assert.ok(scale>0&&scale<=1);assert.ok(width*scale<=702+.0001);assert.ok(height*scale<=898+.0001);
  }
});
const fitFixture=height=>{
  const props={};const content={style:{transform:'scale(0.1)',setProperty(k,v){props[k]=v;}},scrollWidth:700,get scrollHeight(){return height(parseFloat(props['--tutor-name-size']));},getBoundingClientRect(){return{width:700,height:this.scrollHeight};}};
  return {content,body:{clientWidth:704,clientHeight:900},props};
};
await test('Tutor fitter chooses the largest profile that fits and resets stale scaling',()=>{
  const f=fitFixture(font=>font*65),result=fitter.fit(f.body,f.content);
  assert.equal(result.font,13);assert.equal(result.scale,1);assert.equal(f.content.style.transform,'scale(1)');
});
await test('Very full tutor days fit within the page without removing content',()=>{
  const f=fitFixture(()=>1800),result=fitter.fit(f.body,f.content);
  assert.equal(result.font,10);assert.ok(result.effectiveFont<9);assert.ok(1800*result.scale<=898);
  assert.equal(f.content.scrollHeight,1800);
});
await test('Same-hour room fitter keeps the largest room-name size that fits without changing other hours',()=>{
  const props={};
  const content={style:{transform:'scale(0.5)',setProperty(k,v){props[k]=v;}},scrollWidth:700,get scrollHeight(){return 135+15*parseFloat(props['--name-size']);},getBoundingClientRect(){return{width:700,height:this.scrollHeight};}};
  const result=fitter.fitRoom({clientWidth:704,clientHeight:430},content,22);
  assert.ok(result.font>=19.5&&result.font<=19.7);assert.equal(result.scale,1);assert.equal(content.style.transform,'none');
  assert.equal(parseFloat(props['--name-size']),result.font);assert.ok(content.scrollHeight<=428.0001);
});
await test('Invalid or hidden page measurements fail instead of silently clipping',()=>{
  for(const value of [0,-1,NaN,Infinity])assert.throws(()=>fitter.fitScale(700,600,704,value),/could not be measured/);
});
await test('Aryan regular and substitute classes form one chronological roll with all 18 bookings',()=>{
  const sessions=[{id:'sub',tutor:'Aryan Gupta (sub)',start:1080,room:'1',name:'English',booked:5},{id:'early',tutor:'Aryan Gupta',start:960,room:'2',name:'English',booked:6},{id:'middle',tutor:'Aryan Gupta',start:1020,room:'1',name:'Maths',booked:7}].map(s=>({...s,students:Array.from({length:s.booked},(_,i)=>({name:'Student Example '+i}))}));
  const before=JSON.stringify(sessions),groups=model.groups(sessions,'tutors');
  assert.equal(groups.length,1);assert.equal(groups[0].label,'Aryan Gupta');assert.deepEqual(groups[0].sessions.map(s=>s.id),['early','middle','sub']);
  assert.equal(groups[0].sessions.reduce((n,s)=>n+s.students.length,0),18);assert.equal(JSON.stringify(sessions),before);
  assert.equal(model.groups(sessions,'rooms').length,2);assert.equal(model.groups(sessions,'rooms')[0].sessions[1].tutor,'Aryan Gupta (sub)');
});
await test('Substitute suffix matching tolerates spacing and case but preserves other tutor identities',()=>{
  for(const name of ['Aryan Gupta (sub)','Aryan Gupta (SUB)',' Aryan  Gupta  ( sub ) ','Aryan Gupta (Substitute)'])assert.equal(model.tutorName(name),'Aryan Gupta');
  for(const name of ['Subhash Rao','Aryan Gupta (Senior)','Aryan Gupta (sub for Sam)','Aryan Gupta-Smith','(sub)'])assert.equal(model.tutorName(name),name);
  const tutors=['Aryan Gupta',' aryan  gupta (SUB) ','Aryan Sharma','Aryan Gupta (Senior)'].map((tutor,i)=>({tutor,id:String(i),name:'English',start:960}));
  assert.equal(model.groups(tutors,'tutors').length,3);
});
await test('Regular and substitute tutor entries share one page through preview and print rebuild',()=>require('./ui-unit.cjs')({substitute:true}));
await test('Combined classes move together through dropdown, drag/drop and room print preview',()=>require('./ui-unit.cjs')({combined:true}));
for(const [name,fn] of require('./launcher-unit.cjs'))await test(name,fn);
console.log(`\n${passed} tests passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
