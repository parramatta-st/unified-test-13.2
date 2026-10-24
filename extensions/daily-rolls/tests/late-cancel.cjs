const assert=require('node:assert/strict'),reader=require('../reader.js')();
const {fixture,El}=require('./dom-fixture.cjs');
const read=f=>reader.readSession(f.doc,f.href,reader.readDay(f.doc,f.href).sessions[0]);
const rows=f=>f.doc.querySelector('#attendeesList').children.filter(row=>row.children.length===11&&row.attrs.class!=='heading');
module.exports=[
 ['Late cancellation shown beside two active bookings does not block the class',()=>{
  const result=read(fixture({count:2,rows:3,lateCancel:[0]}));
  assert.equal(result.booked,2);assert.deepEqual(result.students.map(s=>s.id),['sample1','sample2']);
  assert.match(result.warnings.join(' '),/1 late cancellation.*excluded/i);
 }],
 ['Late-cancel status, rather than row position, determines who is excluded',()=>{
  const result=read(fixture({count:2,rows:3,lateCancel:[2]}));
  assert.deepEqual(result.students.map(s=>s.id),['sample0','sample1']);
 }],
 ['RSVP, attendance and pending payment do not remove active students',()=>{
  const f=fixture();rows(f)[0].children[6].children[0].checked=true;rows(f)[1].children[8].children[0].checked=true;
  assert.equal(read(f).students.length,2);assert.ok(read(f).students.every(s=>s.payment==='Pending'));
 }],
 ['Live checkbox state takes priority over its initial checked attribute',()=>{
  const f=fixture({count:2,rows:3,lateCancel:[0]});
  rows(f)[0].children[7].children[0].checked=false;rows(f)[2].children[7].children[0].checked=true;
  assert.deepEqual(read(f).students.map(s=>s.id),['sample0','sample1']);
 }],
 ['Duplicate desktop/mobile cancellation rows are excluded only once',()=>{
  const f=fixture({count:2,rows:3,lateCancel:[0]});f.doc.querySelector('#attendeesList').children.push(rows(f)[0]);
  const result=read(f);assert.equal(result.students.length,2);assert.match(result.warnings.join(' '),/^1 late cancellation/);
 }],
 ['Contradictory cancellation states for the same client require another read',()=>{
  const f=fixture({count:2,rows:3,lateCancel:[0]}),duplicate=fixture().doc.querySelector('#attendeesList').children[1];
  f.doc.querySelector('#attendeesList').children.push(duplicate);
  assert.throws(()=>read(f),/cancellation status.*changed/i);
 }],
 ['Unexplained extra names remain blocked rather than trimming to the booked count',()=>{
  assert.throws(()=>read(fixture({count:2,rows:3})),/Incomplete student list/);
  assert.throws(()=>read(fixture({count:2,rows:4,lateCancel:[0]})),/Incomplete student list/);
 }],
 ['Missing active names remain blocked even when a late cancellation is visible',()=>{
  assert.throws(()=>read(fixture({count:2,rows:2,lateCancel:[0]})),/Incomplete student list/);
 }],
 ['A fully cancelled class produces a verified empty booked list',()=>{
  const result=read(fixture({count:0,rows:2,lateCancel:[0,1]}));assert.equal(result.booked,0);assert.deepEqual(result.students,[]);
 }],
 ['Late-cancel column is located by its heading after columns move',()=>{
  const f=fixture({count:2,rows:3,lateCancel:[0]});
  for(const row of f.doc.querySelector('#attendeesList').children.filter(row=>row.children.length===11)) [row.children[7],row.children[8]]=[row.children[8],row.children[7]];
  assert.deepEqual(read(f).students.map(s=>s.id),['sample1','sample2']);
 }],
 ['A cancelled student cannot remove another client with the same name',()=>{
  const result=read(fixture({count:2,rows:3,lateCancel:[1],sameName:true}));
  assert.deepEqual(result.students.map(s=>s.id),['sample0','sample2']);
 }],
];
if(require.main===module){for(const [name,test] of module.exports){test();console.log('PASS',name);}}
