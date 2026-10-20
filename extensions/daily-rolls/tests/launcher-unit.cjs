// Non-rendering DOM fixture using the header structure inspected in Hapana.
// Tests logic and stylesheet contracts, not Chrome layout or hit testing.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRollLauncher}=require('../launcher.js');
class Node {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.id='';this.className='';this.text='';this.attrs={};this.events={};this.classList={contains:c=>this.className.split(' ').includes(c),add:c=>{if(!this.classList.contains(c))this.className=(this.className+' '+c).trim();},remove:c=>{this.className=this.className.split(' ').filter(v=>v!==c).join(' ');}};}
  set textContent(v){this.text=String(v);this.children=[];}
  get textContent(){return this.text+this.children.map(c=>c.textContent).join(' ');}
  get nextElementSibling(){const all=this.parentElement?.children||[];return all[all.indexOf(this)+1]||null;}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  insertBefore(node,before){if(!before){this.append(node);return;}node.remove();assert.ok(this.children.includes(before));this.children.splice(this.children.indexOf(before),0,node);node.parentElement=this;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??this[k]??null;}
  removeAttribute(k){delete this.attrs[k];}
  nodes(){return this.children.flatMap(c=>[c,...c.nodes()]);}
  closest(tag){for(let n=this;n;n=n.parentElement)if(n.tagName===tag.toUpperCase())return n;return null;}
  querySelectorAll(s){
    if(s==='#navbar > ul.navbar-nav')return this.nodes().filter(n=>n.tagName==='UL'&&n.classList.contains('navbar-nav')&&n.parentElement?.id==='navbar');
    return this.nodes().filter(n=>s==='a[href]'?n.tagName==='A'&&!!n.getAttribute('href'):s.startsWith('#')?n.id===s.slice(1):n.tagName===s.toUpperCase());
  }
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}
  async fire(type,extra={}){const event={prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};await Promise.all((this.events[type]||[]).map(fn=>fn(event)));return event;}
}
function fixture({reports=true,missing=false,send}={}) {
  const root=new Node('html'),head=new Node('head'),body=new Node('body');root.append(head,body);
  const doc={head,body,baseURI:'https://core.hapana.com/index.php?route=dashboard/schedule',createElement:t=>new Node(t),getElementById:id=>root.querySelector('#'+id),querySelector:s=>root.querySelector(s)};
  const makeHeader=()=>{
    const header=new Node('header'),nav=new Node('nav'),collapse=new Node('div'),menu=new Node('ul');
    nav.id='hedderNav';collapse.id='navbar';collapse.className='navbar-collapse collapse resp-mainNav';menu.className='nav navbar-nav me-auto mb-lg-0';
    for(const name of ['Home','Schedule','Clients','Payments',...(reports?['Reports']:[])]) {
      const li=new Node('li'),a=new Node('a');li.className='nav-item';a.className='nav-link py-2 py-md-3';a.textContent=name;a.href='index.php?route=dashboard/'+(name==='Reports'?'advreports':name.toLowerCase());li.append(a);menu.append(li);
    }
    collapse.append(menu);nav.append(collapse);header.append(nav);return {header,nav,collapse,menu};
  };
  const h=makeHeader();if(!missing)body.append(h.header);
  const calls=[],frames=[],observers=[];let schedule=true;
  class Observer{constructor(fn){this.fn=fn;observers.push(this);}observe(node,options){this.node=node;this.options=options;}}
  const runtime={sendMessage:async msg=>{calls.push(msg);return send?send(msg):{ok:true};}};
  const launcher=createRollLauncher({document:doc,runtime,isSchedule:()=>schedule,MutationObserver:Observer,requestAnimationFrame:fn=>frames.push(fn)});
  return {doc,body,root,...h,makeHeader,calls,frames,observers,launcher,runtime,setSchedule:v=>schedule=v,
    host:()=>doc.getElementById('stp-rolls-launcher'),link:()=>doc.getElementById('stp-rolls-launcher')?.querySelector('a'),style:()=>doc.getElementById('stp-rolls-launcher-style').textContent,
    mutate(){for(const o of observers)o.fn([]);},flush(){while(frames.length)frames.shift()();}};
}
module.exports=[
  ['Launcher mounts after Reports using native menu classes',()=>{
    const f=fixture();f.launcher.start();assert.equal(f.menu.children.length,6);assert.equal(f.menu.children[4].nextElementSibling,f.host());assert.equal(f.host().parentElement,f.menu);
    assert.equal(f.link().textContent.trim(),'Daily Rolls');assert.ok(f.link().classList.contains('nav-link'));assert.equal(f.link().getAttribute('role'),'button');assert.equal(f.link().href,'#');
  }],
  ['Launcher mount and start are idempotent',()=>{
    const f=fixture();f.launcher.start();const link=f.link();for(let i=0;i<8;i++){f.launcher.start();f.launcher.mount();}
    assert.equal(f.link(),link);assert.equal(f.root.querySelectorAll('#stp-rolls-launcher').length,1);assert.equal(f.root.querySelectorAll('#stp-rolls-launcher-style').length,1);assert.equal(f.observers.length,1);
  }],
  ['A late-loading navigation is handled without a floating fallback',()=>{
    const f=fixture({missing:true});f.launcher.start();assert.equal(f.host(),null);assert.equal(f.body.children.length,0);
    f.body.append(f.header);f.mutate();f.mutate();assert.equal(f.frames.length,1);f.flush();assert.equal(f.host().parentElement,f.menu);
  }],
  ['Hapana header replacement reuses one launcher and restores old header styling',()=>{
    const f=fixture();f.launcher.start();const link=f.link(),next=f.makeHeader();f.header.remove();f.body.append(next.header);f.mutate();f.flush();
    assert.equal(f.link(),link);assert.equal(f.host().parentElement,next.menu);assert.ok(!f.header.classList.contains('stp-rolls-sticky-header'));assert.ok(next.header.classList.contains('stp-rolls-sticky-header'));
  }],
  ['Accounts without Reports get the launcher at the end of their own menu',()=>{
    const f=fixture({reports:false});f.launcher.start();assert.equal(f.menu.children.length,5);assert.equal(f.menu.children[4],f.host());
  }],
  ['Schedule header is sticky below Hapana panels, with no fixed launcher',()=>{
    const f=fixture();f.launcher.start();const css=f.style();assert.match(css,/position:sticky!important;top:0!important;z-index:1000!important/);
    assert.doesNotMatch(css,/position:\s*fixed|z-index:\s*9999|bottom:\s*22px/);
    assert.match(css,/@media print\{header[^}]+position:static!important/);assert.match(css,/@media\(max-width:767px\)/);assert.match(css,/#navbar\.show[^}]+overflow-y:auto/);
    assert.ok(1000<1039&&1039<1040,'Layers measured in the live Add Clients panel');
  }],
  ['Opening a Hapana panel does not move the launcher or change its form controls',()=>{
    const f=fixture();f.launcher.start();const panel=new Node('div'),form=new Node('form'),save=new Node('button');panel.id='invite';panel.className='modal fade right show';save.textContent='Save';form.append(save);panel.append(form);f.body.append(panel);
    const before=panel.textContent;f.mutate();f.flush();assert.equal(panel.textContent,before);assert.equal(save.parentElement,form);assert.equal(f.host().parentElement,f.menu);assert.equal(panel.querySelector('#stp-rolls-launcher'),null);
  }],
  ['Keyboard and mouse launch requests do not submit forms or navigate Hapana',async()=>{
    const f=fixture();f.launcher.start();const e=await f.link().fire('click');assert.ok(e.prevented&&e.stopped);assert.deepEqual(f.calls[0],{namespace:'stp-rolls',type:'OPEN_REVIEW'});
    const space=await f.link().fire('keydown',{key:' '});assert.ok(space.prevented&&space.stopped);assert.equal(f.calls.length,2);
    await f.link().fire('keydown',{key:'Escape'});assert.equal(f.calls.length,2);
  }],
  ['Repeated clicks while opening create only one launch request',async()=>{
    let resolve;const f=fixture({send:()=>new Promise(r=>resolve=r)});f.launcher.start();const first=f.link().fire('click');await f.link().fire('click');assert.equal(f.calls.length,1);assert.equal(f.link().getAttribute('aria-disabled'),'true');
    resolve({ok:true});await first;assert.equal(f.link().getAttribute('aria-disabled'),null);assert.equal(f.link().getAttribute('aria-busy'),null);
  }],
  ['Failed or disconnected launch requests show a clear recoverable error',async()=>{
    for(const send of [async()=>({ok:false}),async()=>{throw new Error('Extension context invalidated');}]){
      const f=fixture({send});f.launcher.start();await f.link().fire('click');assert.match(f.link().textContent,/Reload Hapana/);assert.match(f.link().title,/Refresh Hapana/);assert.equal(f.link().getAttribute('aria-disabled'),null);
      f.runtime.sendMessage=async()=>({ok:true});await f.link().fire('click');assert.match(f.link().textContent,/Daily Rolls/);
    }
  }],
  ['Leaving Schedule removes the launcher and sticky-header change',async()=>{
    const f=fixture();f.launcher.start();const link=f.link();f.setSchedule(false);f.launcher.mount();assert.equal(f.host(),null);assert.ok(!f.header.classList.contains('stp-rolls-sticky-header'));await link.fire('click');assert.equal(f.calls.length,0);
  }],
  ['Only the old extension-owned floating button is removed',()=>{
    const f=fixture(),old=new Node('div'),save=new Node('button');old.id='stp-rolls-launcher';save.textContent='Save';f.body.append(old,save);f.launcher.start();assert.equal(old.parentElement,null);assert.equal(save.parentElement,f.body);assert.equal(f.root.querySelectorAll('#stp-rolls-launcher').length,1);
  }],
  ['Manifest loads launcher before content script and content wiring preserves reader responses',()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json')));assert.deepEqual(manifest.content_scripts[0].js,['reader.js','launcher.js','content.js']);
    let handler,startCount=0;const sandbox={URL,location:{href:'https://core.hapana.com/index.php?route=dashboard/schedule'},document:{},MutationObserver:class{},window:{requestAnimationFrame(){}},createHapanaReader:()=>({readDay:()=>({date:'2026-09-12'}),readSession:()=>({booked:0})}),createRollLauncher:()=>({start(){startCount++;}}),chrome:{runtime:{id:'test',onMessage:{addListener:fn=>handler=fn}}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),sandbox);assert.equal(startCount,1);
    let response;handler({namespace:'stp-rolls',type:'READ_DAY'},{id:'test'},r=>response=r);assert.equal(response.data.date,'2026-09-12');response=null;handler({namespace:'stp-rolls',type:'READ_DAY'},{id:'wrong'},r=>response=r);assert.equal(response,null);
  }]
];
