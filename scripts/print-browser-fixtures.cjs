const crypto=require('node:crypto');
const ORIGIN='http://127.0.0.1:3100',SECRET='isolated-browser-audit-only';
function token(){const payload=Buffer.from(JSON.stringify({tutor:'QA Tutor',campus:'parramatta',role:'admin',exp:Date.now()+3600000})).toString('base64url');const head='v1.'+payload;return head+'.'+crypto.createHmac('sha256','st-portal-session:'+SECRET).update(head).digest('base64url');}
async function waitServer(){for(let i=0;i<90;i++){try{if((await fetch(ORIGIN+'/api/healthz')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}throw Error('Local Next test server did not start');}
async function routeApis(page){
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let json;
  if(url.pathname==='/api/admin-status')json={ok:true,authed:true,isAdmin:true,campus:'parramatta',tutor:'QA Tutor'};
  else if(url.pathname==='/api/tutors')json={ok:true,tutors:[{tutorName:'QA Tutor',campusKey:'parramatta',campusName:'Parramatta',role:'admin'}],campuses:[{id:'parramatta',name:'Parramatta'}]};
  else if(url.pathname==='/api/feedback-schedule')json={ok:true,configured:true,tutorName:'QA Tutor',sessions:[{key:'16:00|17:00',startLabel:'4:00pm',endLabel:'5:00pm',students:[{id:'qa-student-001',memberMatched:true,name:'QA Student',firstName:'QA',lastName:'Student',email:'qa-parent@example.invalid',parentName:'QA Parent',year:'',gender:'',pronouns:''}]}]};
  else if(url.pathname==='/api/curriculum')json={ok:true,rows:[{Year:'Year 4',Subject:'English',Strand:'Basics of Language',Lesson:'1',Topic:'Grammar',Template1:'{name} is improving.'}]};
  else if(url.pathname==='/api/print-settings')json={ok:true,settings:{}};
  else if(url.pathname==='/api/inbox-unread')json={ok:true,count:0,unreadCount:0};
  else if(url.pathname==='/api/time-clock')json={ok:true,tutorName:'QA Tutor',activeShift:null,shifts:[],history:[],status:'clocked_out',serverTime:new Date().toISOString()};
  else if(url.pathname==='/api/contacts')json={ok:true,students:[]};
  else if(url.pathname==='/api/healthz')json={ok:true};
  else {console.error('Unrecognised synthetic API:',url.pathname);return route.fulfill({status:501,contentType:'application/json',body:'{"ok":false,"error":"Missing test fixture"}'});}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
 });
}
module.exports={ORIGIN,SECRET,token,waitServer,routeApis};
