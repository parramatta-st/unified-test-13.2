const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const createScheduleModel=require('../schedule-model.js'),model=require('../feedback-model.js')(createScheduleModel());
const input={day:{date:'2026-10-20',sessions:[{id:'2026-10-20:1:1'}],excluded:[]},sessions:[{id:'2026-10-20:1:1',name:'English',tutor:'Sai Arulanathan',start:960,end:1020,booked:1,students:[{id:'hapana-student',name:'Example Student',phone:'PRIVATE_PHONE',payment:'PRIVATE_PAYMENT'}]}],startedAt:'2026-10-19T23:00:00.000Z',completedAt:'2026-10-19T23:01:00.000Z',captureId:'feedback-one'};
const capture=model.capture(input);assert.equal(capture.schemaVersion,2);assert.equal(capture.sessions[0].students[0].id,'hapana-student');assert.ok(!JSON.stringify(capture).includes('PRIVATE_'));
for(const change of [{demo:true},{collecting:true},{errors:[{}]},{sessions:[]},{sessions:[{...input.sessions[0],booked:2}]},{sessions:[{...input.sessions[0],students:[{name:'No ID'}]}]}])assert.throws(()=>model.capture({...input,...change}));
console.log('PASS: student payload is verified, excludes phone/payment data and rejects incomplete/demo collections');
(async()=>{
 const {Node}=require('./ui-unit.cjs'),status=new Node(),retry=new Node();
 const sandbox={document:{getElementById:id=>id==='feedback-sync-status'?status:retry},console};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../feedback-sync-ui.js'),'utf8'),sandbox);
 let fail=false,calls=0;
 const ui=sandbox.createFeedbackSyncUI({installed:true,demo:false,getCapture:()=>capture,getTicket:()=> 'fixture-ticket',background:async(type,body)=>{calls++;assert.equal(type,'SYNC_FEEDBACK_SCHEDULE');assert.equal(body.ticket,'fixture-ticket');if(fail)throw Error('Admin sign-in required');return{ok:true,date:input.day.date,sessions:1,bookings:1};}});
 await ui.save();assert.match(status.textContent,/Student bookings synced to Feedback/);assert.equal(retry.disabled,false);
 fail=true;await ui.save();assert.match(status.textContent,/NOT been confirmed.*Admin sign-in required/);assert.equal(calls,2);assert.equal(retry.disabled,false);
 ui.incomplete();assert.equal(retry.disabled,true);
 console.log('PASS: student-sync confirmation, failure and retry are separate from local tutor backups');
})().catch(error=>{console.error(error);process.exitCode=1;});
