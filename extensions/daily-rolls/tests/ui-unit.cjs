// Non-rendering unit fixture for review.js event handlers. Not a browser and
// not a substitute for a real extension install, CSS layout or print test.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Node {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.listeners={};this.dataset={};this.style={setProperty:(key,value)=>{this.style[key]=String(value);}};this.className='';this.text='';this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.attrs={};this.classList={add:(s)=>{this.className+=' '+s;},remove:(s)=>{this.className=this.className.split(' ').filter(c=>c!==s).join(' ');}};}
  set textContent(s){this.text=String(s);this.children=[];}
  get textContent(){return this.text+this.children.map(c=>typeof c==='string'?c:c.textContent).join(' ');}
  append(...items){for(const item of items){if(typeof item!=='string')item.parentElement=this;this.children.push(item);}}
  replaceChildren(...items){this.children=[];this.text='';this.append(...items);}
  setAttribute(key,value){this.attrs[key]=value;}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  async fire(type,event={}){for(const fn of this.listeners[type]||[])await fn(event);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  nodes(){return this.children.flatMap(c=>typeof c==='string'?[]:[c,...c.nodes()]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){return this.nodes().filter(c=>selector[0]==='.'?c.className.split(' ').includes(selector.slice(1)):c.tagName===selector.toUpperCase());}
  contains(node){return this===node||this.nodes().includes(node);}
  focus(){}
  // Synthetic geometry tests event flow, not actual CSS or browser pagination.
  get scrollHeight(){
    if(Node.dense&&this.className==='tutor-fit-content')return this.querySelectorAll('.name-cell').length*30+this.children.length*45;
    if(Node.roomHourOverflow&&this.className==='room-hour-fit-content'){const font=parseFloat(this.style['--name-size']||22);return this.querySelectorAll('.name-cell').length*font+this.children.length*45;}
    if(Node.roomHourOverflow&&this.className==='print-class')return 60;
    if(Node.roomHourOverflow&&this.className==='page-body')return this.children.reduce((total,child)=>total+(typeof child==='string'?0:child.scrollHeight),0);
    return 1;
  }
  get clientHeight(){return Node.dense?100:Node.roomHourOverflow&&this.className==='page-body'?270:100000;}
  get scrollWidth(){return 700;}
  get clientWidth(){return 704;}
  getBoundingClientRect(){return {width:700,height:this.scrollHeight};}
}
function runUIUnit({substitute=false,combined=false}={}){
  const root=new Node('body'),ids={};
  const html=fs.readFileSync(path.join(__dirname,'../review.html'),'utf8');
  for(const match of html.matchAll(/<([a-z-]+)[^>]*\bid="([^"]+)"[^>]*>/g)){ids[match[2]]=new Node(match[1]);ids[match[2]].id=match[2];root.append(ids[match[2]]);}
  const workspace=new Node();workspace.className='workspace';root.append(workspace);
  ids['name-size'].value='22';ids['show-phone'].checked=true;ids['show-payment'].checked=true;
  const doc={createElement:tag=>new Node(tag),getElementById:id=>ids[id],querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),documentElement:new Node('html'),title:''};
  const events={};
  const createModel=()=>{
    const model=require('../model.js')();
    if(substitute){const suggest=model.suggest;model.suggest=sessions=>suggest(sessions.map(s=>({...s,tutor:s.id==='demo-0'?'Aryan Gupta':s.id==='demo-3'?'Aryan Gupta (sub)':s.tutor})));}
    if(combined){const suggest=model.suggest;model.suggest=sessions=>suggest(sessions.map(s=>({...s,tutor:s.id==='demo-0'?'Combined Tutor':s.id==='demo-1'?'Combined Tutor (sub)':s.tutor})));}
    return model;
  };
  const sandbox={document:doc,location:{search:'?demo=1'},URLSearchParams,Intl,Date,console,confirm:()=>true,setTimeout,createRollModel:createModel,createScheduleModel:require('../schedule-model.js'),createScheduleUI:()=>({load(){},save(){},incomplete(){}}),createHapanaReader:require('../reader.js'),createPrintFitter:require('../print-fit.js').createPrintFitter,window:{addEventListener:(type,fn)=>events[type]=fn,scrollTo(){},print(){}}};
  vm.createContext(sandbox);
  for(const name of ['feedback-model.js','feedback-sync-ui.js','review.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),sandbox);
  assert.match(ids['date-heading'].textContent,/Monday,? 14 September 2026/);
  assert.equal(ids['print-all'].disabled,true,'Unknown class initially needs a room');
  const findCard=id=>ids.board.querySelectorAll('.class-card').find(c=>c.dataset.id===id);
  const choose=(id,room)=>{const s=findCard(id).querySelector('select');s.value=room;s.fire('change');};
  if(combined){
    assert.equal(findCard('demo-0').querySelector('select').value,'1');
    assert.equal(findCard('demo-1').querySelector('select').value,'1');
    choose('demo-1','4');assert.equal(findCard('demo-0').querySelector('select').value,'4');
    ids.board.children.find(c=>c.dataset.room==='2').fire('drop',{preventDefault(){},dataTransfer:{getData:()=> 'demo-0'}});
    assert.equal(findCard('demo-0').querySelector('select').value,'2');assert.equal(findCard('demo-1').querySelector('select').value,'2');
    choose('demo-6','3');ids['preview-rooms'].fire('click');
    assert.equal(ids['print-pages'].querySelectorAll('.print-class').length,7);
    assert.equal(ids['print-pages'].querySelectorAll('.name-cell').length,32);
    const room2=ids['print-pages'].children.filter(p=>p.querySelector('h1').textContent==='Room 2');
    assert.ok(room2.some(p=>p.textContent.includes('Combined Tutor')&&p.querySelectorAll('.print-class').length>=2));
    events.beforeprint();assert.equal(ids['print-pages'].querySelectorAll('.name-cell').length,32);
    return;
  }
  choose('demo-6','2');
  assert.equal(ids['print-all'].disabled,false);
  choose('demo-1','1');
  const room1=ids.board.children.find(c=>c.dataset.room==='1');
  assert.equal(room1.querySelectorAll('.class-card').length,3,'Overlapping class can share Room 1');
  Node.roomHourOverflow=true;
  ids['preview-rooms'].fire('click');
  assert.equal(ids['print-pages'].children.length,4,'Only the crowded simultaneous hour gains its own fitted page; other room pagination stays normal');
  const room1Pages=ids['print-pages'].children.filter(p=>p.querySelector('h1').textContent==='Room 1');
  assert.equal(room1Pages.length,2,'Room 1 keeps its later hour separate instead of shrinking the whole room');
  const sharedHour=room1Pages[0].querySelector('.room-hour-fit-content');
  assert.ok(sharedHour,'The two simultaneous Room 1 classes are kept together as one hour block');
  assert.equal(sharedHour.querySelectorAll('.print-class').length,2,'Both classes in the shared hour stay on the same sheet');
  const crowdedFont=parseFloat(sharedHour.style['--name-size']);
  assert.ok(crowdedFont<22&&crowdedFont>=19.5,'Only the crowded hour reduces to the largest name size that fits');
  assert.equal(sharedHour.style.transform,'none','Normal hour fitting changes only the name size, not the whole layout');
  assert.equal(room1Pages[1].querySelectorAll('.print-class').length,1,'The later Room 1 hour remains its normal standalone section');
  assert.equal(room1Pages[1].querySelectorAll('.room-hour-fit-content').length,0,'The unaffected later hour is not placed inside a reduced wrapper');
  assert.equal(parseFloat(doc.documentElement.style['--name-size']),22,'Unaffected hours retain the selected maximum room-roll size');
  assert.equal(ids['print-pages'].querySelectorAll('.room-hour-fit-content').length,1,'No other hour or room is reduced');
  Node.roomHourOverflow=false;
  const roomText=ids['print-pages'].textContent;
  assert.match(roomText,/DEMO — FICTIONAL SAMPLE DATA/);
  assert.ok(!roomText.includes('04XX'),'No phone number on room sheets');
  assert.ok(!roomText.includes('Sample only'),'No payment on room sheets');
  assert.equal(ids['print-pages'].querySelectorAll('.tick-box').length,0);
  assert.ok(ids['print-pages'].querySelectorAll('.print-class').length===7);
  ids.back.fire('click');ids['preview-tutors'].fire('click');
  assert.equal(ids['print-pages'].children.length,4,'Exactly one page for each of the four tutors');
  assert.equal(ids['print-pages'].querySelectorAll('.tutor-page').length,4);
  assert.equal(ids['print-pages'].querySelectorAll('.print-class').length,7,'All classes included');
  assert.equal(ids['print-pages'].querySelectorAll('.name-cell').length,32,'All bookings included');
  if(substitute){
    const page=ids['print-pages'].querySelectorAll('.tutor-page').filter(p=>p.querySelector('h1').textContent==='Aryan Gupta');
    assert.equal(page.length,1,'Ordinary and substitute entries share one Aryan page');
    assert.equal(page[0].querySelectorAll('.print-class').length,2);
    assert.equal(page[0].querySelectorAll('.name-cell').length,10);
  }
  assert.match(ids['print-pages'].textContent,/04XX XXX XXX/);
  assert.match(ids['print-pages'].textContent,/Sample only/);
  assert.ok(ids['print-pages'].querySelectorAll('.tick-box').length>0);
  Node.dense=true;
  ids['preview-tutors'].fire('click');
  assert.equal(ids['print-pages'].children.length,4,'Dense tutor content still creates only four pages');
  assert.equal(ids['print-pages'].querySelectorAll('.name-cell').length,32,'Dense fitting retains every booking');
  assert.ok(ids['print-pages'].querySelectorAll('.tutor-fit-content').every(el=>Number(el.style.transform.match(/scale\((.*)\)/)[1])<1));
  assert.equal(ids['print-fit-notice'].hidden,false,'Dense layout notice is visible');
  Node.dense=false;
  ids.back.fire('click');ids['show-phone'].checked=false;ids['show-payment'].checked=false;ids['preview-tutors'].fire('click');
  assert.ok(!ids['print-pages'].textContent.includes('04XX'));
  assert.ok(!ids['print-pages'].textContent.includes('Sample only'));
  ids.back.fire('click');ids.clear.fire('click');
  assert.equal(ids['print-all'].disabled,true);
  assert.equal(ids.board.children.length,5,'Unassigned plus all four rooms');
  ids.suggest.fire('click');
  assert.equal(ids['print-all'].disabled,true,'Selective still requires a room');
  choose('demo-6','4');ids['print-all'].fire('click');
  assert.equal(ids['print-pages'].querySelectorAll('.print-class').length,14,'All preview contains both versions');
  events.beforeprint();
  assert.equal(ids['print-pages'].querySelectorAll('.print-class').length,14,'Print rebuild does not duplicate pages');
  assert.equal(ids['print-pages'].querySelectorAll('.tutor-page').length,4,'Browser print rebuild retains one page per tutor');
  assert.equal(ids['print-fit-notice'].hidden,true,'Previous dense warning is cleared');
}
module.exports=runUIUnit;
module.exports.Node=Node;
