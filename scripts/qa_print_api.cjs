/** Real Next API -> local fake printer -> local history webhook/CSV. No cloud or ink. */
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const Papa=require('papaparse');
const ORIGIN='http://127.0.0.1:3110',SERVICE='http://127.0.0.1:3210';
const SECRET='local-print-api-integration-only';
const records=[],prints=[];let failHistory=false;
const fake=http.createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;
 const body=text?JSON.parse(text):{};
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/print'){prints.push({body,headers:req.headers});return res.end(JSON.stringify({ok:true,jobId:'fictional-'+prints.length}));}
 if(req.url==='/log'){
  if(failHistory){res.statusCode=503;return res.end('{"ok":false}');}
  records.push({Timestamp:body.when,Student:body.student,Tutor:body.tutor,OK:body.ok?'TRUE':'FALSE',Raw:JSON.stringify(body)});return res.end('{"ok":true}');
 }
 if(req.url==='/log.csv'){res.setHeader('Content-Type','text/csv');return res.end(Papa.unparse(records));}
 res.statusCode=404;res.end('{}');
});
function token(campus='parramatta'){
 const payload=Buffer.from(JSON.stringify({tutor:'API QA Tutor',campus,role:'tutor',exp:Date.now()+3600000})).toString('base64url');
 const head='v1.'+payload;return head+'.'+crypto.createHmac('sha256','st-portal-session:'+SECRET).update(head).digest('base64url');
}
async function ready(){for(let i=0;i<60;i++){try{if((await fetch(ORIGIN+'/api/healthz')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}throw Error('API test server did not start');}
(async()=>{
 await new Promise(resolve=>fake.listen(3210,'127.0.0.1',resolve));
 const env={...process.env};
 for(const key of Object.keys(env))if(/^(GOOGLE_|PRINT_|NEXT_PUBLIC_PRINT_|PRIVATE_SHEETS)/.test(key))delete env[key];
 Object.assign(env,{SESSION_SECRET:SECRET,TUTOR_PASSWORD:'fictional',PRINT_API_URL:SERVICE,PRINT_API_TOKEN:'fictional-token',PRINT_LOG_WEBHOOK_URL:SERVICE+'/log',PRINT_LOG_CSV_URL:SERVICE+'/log.csv',NEXT_TELEMETRY_DISABLED:'1'});
 const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3110'],{env,stdio:['ignore','pipe','pipe']});let logs='';app.stderr.on('data',data=>logs+=data);
 try{
  await ready();
  const send=async(id,source='manual-print')=>fetch(ORIGIN+'/api/print-proxy?action=print',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'st_sess='+token()},body:JSON.stringify({material_id:id,qty:2,printColorMode:'bw',meta:{student:'API QA Student',tutor:'Forged Tutor'},portalLog:{batchId:'api-batch-1',batchStudentSize:2,studentId:'api-student',names:['Lesson '+id],year:'Year 4',subject:'English',campusKey:'Forged campus',tutor:'Forged Tutor',sourceForm:source}})});
  const response=await send(1);assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  await send(2,'rolling-print-queue');
  assert.equal(prints.length,2);assert.equal(prints[0].body.portalLog,undefined);assert.equal(prints[0].body.meta.tutor,'API QA Tutor');assert.equal(prints[0].headers['x-print-color-mode'],'monochrome');
  assert.equal(records[0].Tutor,'API QA Tutor');assert.equal(JSON.parse(records[0].Raw).campusKey,'parramatta');
  const history=await fetch(ORIGIN+'/api/student-print-history?studentId=api-student&studentName=API%20QA%20Student',{headers:{Cookie:'st_sess='+token()}}).then(r=>r.json());
  assert.equal(history.ok,true);assert.equal(history.prints.length,2);assert.ok(history.prints.some(p=>p.source==='manual'));assert.ok(history.prints.some(p=>p.source==='automatic'));
  const other=await fetch(ORIGIN+'/api/student-print-history?studentId=api-student&studentName=API%20QA%20Student',{headers:{Cookie:'st_sess='+token('other-centre')}}).then(r=>r.json());assert.equal(other.prints.length,0);
  assert.equal((await fetch(ORIGIN+'/api/student-print-history?studentName=API%20QA%20Student')).status,401);
  failHistory=true;const partial=await send(3).then(r=>r.json());assert.equal(partial.ok,true);assert.match(partial.logWarning,/accepted/);assert.equal(prints.length,3);
  console.log('PASS: real signed API -> fake Mac acceptance -> history webhook -> CSV read -> scoped history response.');
  console.log('PASS: server-authenticated identities, colour forwarding, manual/automatic sources, cross-campus exclusion, unauthenticated rejection and accepted-print/log-failure boundary.');
 }finally{if(app.exitCode===null){app.kill('SIGTERM');await new Promise(resolve=>app.once('exit',resolve));}await new Promise(resolve=>fake.close(resolve));if(logs)console.log(logs.slice(-1500));}
})().catch(error=>{console.error(error);fake.close();process.exitCode=1;});
