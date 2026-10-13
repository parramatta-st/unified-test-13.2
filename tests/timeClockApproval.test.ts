import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockEvent, replayTimeClockEvents, buildPayrollRange, requestFingerprint } from '../lib/timeClock';
import { parseTimeEntry, formatTimeEntry } from '../lib/timeClockEntry';
const begin='2026-10-12T00:00:00.000Z';
function event(action:string,extra:any={}) {
  const requestId=`approval_${action}_${Math.random().toString(36).slice(2)}`;
  return createClockEvent({requestId,requestFingerprint:requestFingerprint({requestId}),campusKey:'parramatta',tutorId:'kevin',tutorName:'Kevin',actorName:'Admin',actorRole:'admin',targetShiftId:'shift_1',occurredAt:begin,clockIn:begin,clockOut:'2026-10-12T09:00:00.000Z',action,...extra});
}
const payroll=(r:any)=>buildPayrollRange({state:{...r,sourceFingerprint:'',rawEventCount:r.events.length},campusKey:'parramatta',startMs:Date.parse(begin),endMs:Date.parse('2026-10-13T00:00:00Z')});
test('manual time fields accept explicit everyday and 24-hour formats, rejecting ambiguity',()=>{
  for(const [input,expected] of [['4pm','16:00'],['4:30 pm','16:30'],['4.30PM','16:30'],['16:30','16:30'],['12am','00:00'],['12:05 pm','12:05'],['00:15','00:15']])assert.equal(parseTimeEntry(input),expected,input);
  for(const input of ['4','25:00','13pm','4:60pm','4:3pm','abc','-1am',''])assert.equal(parseTimeEntry(input),null,input);
  assert.equal(formatTimeEntry('16:30'),'4:30 pm');assert.equal(formatTimeEntry('4pm'),'4:00 pm');assert.equal(formatTimeEntry('wrong'),'wrong');
});
test('exactly eight hours is clear and one second over needs review, open or completed',()=>{
  for(const seconds of [0,1]) {
    const end=new Date(Date.parse(begin)+8*3600000+seconds*1000).toISOString();
    const closed=replayTimeClockEvents([event('admin_create',{clockOut:end})],{nowMs:Date.parse(end)});
    assert.equal(closed.shifts[0].reviewFlags.includes('long_shift'),seconds===1);
    const open=replayTimeClockEvents([event('admin_create',{clockOut:''})],{nowMs:Date.parse(end)});
    assert.equal(open.shifts[0].reviewFlags.includes('open_over_limit'),seconds===1);
    assert.equal(open.shifts[0].clockOut,'');
  }
});
test('long completed hours are held, versioned approval restores payroll and is audited',()=>{
  const created=event('admin_create'),approval=event('admin_approve',{baseVersion:'1',occurredAt:'2026-10-12T10:00:00.000Z'});
  const before=replayTimeClockEvents([created]);assert.equal(payroll(before).summary[0].totalMinutes,0);assert.equal(payroll(before).summary[0].reviewCount,1);
  const after=replayTimeClockEvents([created,approval]);assert.equal(after.shifts[0].reviewFlags.includes('long_shift'),false);assert.equal(after.shifts[0].approvedBy,'Admin');assert.equal(after.shifts[0].version,2);assert.equal(after.adjustments[1].action,'approved');assert.equal(payroll(after).summary[0].totalMinutes,540);
});
test('approval rejects open shifts, tutor actors, stale versions and future finish times',()=>{
  const open=event('admin_create',{clockOut:''}),closed=event('admin_create');
  const cases=[{base:open,patch:{baseVersion:'1'},code:'COMPLETE_SHIFT_REQUIRED'},{base:closed,patch:{baseVersion:'1',actorRole:'tutor'},code:'ADMIN_REQUIRED'},{base:closed,patch:{baseVersion:'2'},code:'STALE_SHIFT'},{base:closed,patch:{baseVersion:'1',occurredAt:begin},code:'COMPLETE_SHIFT_REQUIRED'}];
  for(const {base,patch,code} of cases){const approval=event('admin_approve',{occurredAt:'2026-10-12T10:00:00.000Z',...patch}),r=replayTimeClockEvents([base,approval]);assert.equal(r.outcomes.get(approval.eventId)?.code,code);}
});
test('editing approved times invalidates approval, and an approval retry is idempotent',()=>{
  const created=event('admin_create'),approval=event('admin_approve',{baseVersion:'1',occurredAt:'2026-10-12T10:00:00.000Z'});
  const replay=replayTimeClockEvents([created,approval,approval]);assert.equal(replay.shifts[0].version,2);assert.equal(replay.adjustments.length,2);
  const edit=event('admin_edit',{baseVersion:'2',reason:'Correct end time',clockOut:'2026-10-12T09:30:00.000Z',occurredAt:'2026-10-12T11:00:00.000Z'});
  const changed=replayTimeClockEvents([created,approval,edit]);assert.equal(changed.shifts[0].approvedBy,'');assert.ok(changed.shifts[0].reviewFlags.includes('long_shift'));assert.equal(payroll(changed).summary[0].totalMinutes,0);
});
