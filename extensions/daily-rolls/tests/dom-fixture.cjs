// Minimal in-memory DOM fixture, not a browser or replacement browser runtime.
// It models only the elements/selectors used by reader.js and holds fictional data.
class El {
  constructor(tag='div',text='',attrs={},children=[]) {this.tagName=tag.toUpperCase();this.text=text;this.attrs=attrs;this.checked=Object.hasOwn(attrs,'checked');this.children=children;for(const child of children)child.parentElement=this;}
  get textContent(){return this.text+this.children.map(c=>c.textContent).join(' ');}
  getAttribute(key){return this.attrs[key]??null;}
  closest(selector){let node=this;while(node){if(node.tagName===selector.toUpperCase())return node;node=node.parentElement;}return null;}
  descendants(){return this.children.flatMap(c=>[c,...c.descendants()]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){
    if(selector===':scope > li')return this.children.filter(c=>c.tagName==='LI');
    const nodes=this.descendants();
    if(selector==='li strong')return nodes.filter(c=>c.tagName==='STRONG'&&c.closest('li'));
    const selectors=selector.split(',');
    return nodes.filter(n=>selectors.some(s=>{
      if(s.startsWith('#'))return n.attrs.id===s.slice(1);
      if(s==='a[href]')return n.tagName==='A'&&'href'in n.attrs;
      if(s==='a[href*="cid="]')return n.tagName==='A'&&n.attrs.href?.includes('cid=');
      if(s==='li.heading')return n.tagName==='LI'&&n.attrs.class==='heading';
      if(s==='[title="Edit Session Instructor"][data-eid]')return n.attrs.title==='Edit Session Instructor'&&'data-eid'in n.attrs;
      if(s==='input[type="password"]')return n.tagName==='INPUT'&&n.attrs.type==='password';
      if(s==='input[type="checkbox"]')return n.tagName==='INPUT'&&n.attrs.type==='checkbox';
      return n.tagName===s.toUpperCase();
    }));
  }
}
function fixture({count=2,rows=2,mobile=true,date='2026-09-12',tutor='Tutor Example',campus='Parramatta',eid='100',payment='Pending',phone='04XX XXX XXX',sameName=false,lateCancel=[]}={}) {
  const dateText='Saturday, September 12, 2026';
  const href=`https://core.hapana.com/index.php?route=dashboard/schedule&seid=100&dt=${date}&eid=${eid}&curr=${date}`;
  const labels=['','Client Name','Email','Phone #','Payment Type','','RSVP','Late Cancel','Attend.','',''];
  const property=(key,value)=>new El('li','',{},[new El('div','',{},[new El('strong',key+':')]),new El('div',value)]);
  const ids=new El('span','',{title:'Edit Session Instructor','data-eid':eid,'data-bstd':date});
  const attendeeRows=[];
  for(let i=0;i<rows;i++){
    const name=sameName?'Identical Sample Name':`Student Example ${i+1}`;
    const a=()=>new El('a',name,{href:`https://core.hapana.com/index.php?route=dashboard/clients/assessment&cid=sample${i}#schedule`});
    const cells=labels.map(()=>new El());cells[0].text=String(i+1);cells[1]=new El('div','',{},[a()]);cells[3].text=phone;cells[4].text=payment;
    for(const column of [6,7,8])cells[column].children=[new El('input','',{type:'checkbox',...(column===7&&lateCancel.includes(i)?{checked:''}:{})})];
    attendeeRows.push(new El('li','',{},cells));
    if(mobile)attendeeRows.push(new El('li','',{},[new El('div','',{},[a()])]));
  }
  return {href,doc:new El('body','',{},[
    new El('h2',dateText),
    new El('ul','',{id:'getdaymyEvents'},[new El('li','',{},[new El('a',`10:00 AM K-6 English Study Hub(${count})`,{href})])]),
    new El('div','',{id:'eventLoad'},[new El('h4','K-6 English Study Hub - 10:00 AM - 11:00 AM'),new El('ul','',{},[property('Instructor',tutor),property('Location',campus)]),ids]),
    new El('div',`Total Booked: ${count} | Capacity: 6 | Checked In: 0 | Late Cancel: ${lateCancel.length}`),
    new El('ul','',{id:'attendeesList'},[new El('li','',{class:'heading'},labels.map(s=>new El('div',s))),...attendeeRows])
  ])};
}
module.exports={El,fixture};
