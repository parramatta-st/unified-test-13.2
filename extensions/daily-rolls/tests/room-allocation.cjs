const assert=require('node:assert/strict'),model=require('../model.js')();
const session=(id,extra={})=>({id,name:'K-6 English',tutor:'Example Tutor',start:960,end:1020,booked:6,room:'',...extra});
module.exports=[
 ['Overlapping classes for one full tutor identity share a room, including substitute suffixes',()=>{
  const input=[session('a'),session('b',{tutor:' example  tutor (SUB) '}),session('c',{tutor:'Example Other'})],before=JSON.stringify(input);
  const result=model.suggest(input);
  assert.equal(result[0].room,result[1].room);assert.notEqual(result[0].room,result[2].room);
  assert.equal(JSON.stringify(input),before);assert.equal(result.length,3);
 }],
 ['Combined booking totals get the larger primary room before smaller tutor groups',()=>{
  const result=model.suggest([session('a'),session('b'),session('c',{tutor:'Other Tutor',booked:10}),session('d',{tutor:'Third Tutor',booked:9})]);
  assert.deepEqual(result.map(s=>s.room),['2','2','3','4']);
 }],
 ['Overlapping chains move together while the following adjacent hour stays independent',()=>{
  const input=[session('a',{end:1080}),session('b'),session('c',{start:1020,end:1080}),session('d',{start:1080,end:1140,room:'3'})];
  const result=model.assignRoom(input,'b','4');assert.deepEqual(result.map(s=>s.room),['4','4','4','3']);
  assert.equal(input[0].room,'');assert.equal(model.validate(result,[],false),'');
 }],
 ['Matching first names and absent tutors never link unrelated classes',()=>{
  for(const tutors of [['Example One','Example Two'],['','']]){
   const input=model.suggest(tutors.map((tutor,i)=>session(String(i),{tutor})));
   const result=model.assignRoom(input,'0','4');assert.equal(result[0].room,'4');assert.equal(result[1].room,input[1].room);
  }
 }],
 ['Different dates and campuses are independent even with the same tutor and time',()=>{
  const result=model.assignRoom([session('a',{date:'2026-10-21',campus:'Parramatta'}),session('b',{date:'2026-10-22',campus:'Parramatta'}),session('c',{date:'2026-10-21',campus:'Other'})],'a','4');
  assert.deepEqual(result.map(s=>s.room),['4','','']);
 }],
 ['A combined senior and primary class uses Room 1; a standalone special program still needs a choice',()=>{
  const result=model.suggest([session('a',{name:'7-10 Maths'}),session('b'),session('c',{tutor:'Special Tutor',name:'Selective'})]);
  assert.deepEqual(result.map(s=>s.room),['1','1','']);
 }],
 ['Partial collection keeps the existing room and attaches a recovered same-tutor class',()=>{
  const result=model.suggest([session('a',{room:'4'}),session('b'),session('c',{tutor:'Other Tutor'})],{preserve:true});
  assert.deepEqual(result.map(s=>s.room),['4','4','2']);
 }],
 ['Conflicting rooms are caught before printing and normalised on a retry',()=>{
  const input=[session('b',{room:'3'}),session('a',{room:'2'})];
  assert.match(model.validate(input,[],false),/must share one room/);
  assert.deepEqual(model.suggest(input,{preserve:true}).map(s=>s.room),['2','2']);
  const cleared=model.assignRoom(input,'a','');assert.deepEqual(cleared.map(s=>s.room),['','']);
  assert.match(model.validate(cleared,[],false),/Choose a room/);
 }],
];
