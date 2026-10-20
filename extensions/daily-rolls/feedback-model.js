/* Student schedule payload. Never include phone, payment or parent contact data. */
function createFeedbackModel(schedules=createScheduleModel()) {
  function capture(input) {
    const core=schedules.capture(input);
    const originals=new Map(input.sessions.map(session=>[session.id,session]));
    const sessions=core.sessions.map(session=>{
      const original=originals.get(session.hapanaSessionId);
      if(!Array.isArray(original?.students)||original.students.length!==original.booked||original.students.length>200)throw new Error('Verify every student against the booking count before syncing Feedback.');
      const students=original.students.map(student=>{
        const id=String(student.id||'').trim(),name=String(student.name||'').replace(/\s+/g,' ').trim();
        if(!id||id.length>80||!name||name.length>200)throw new Error('Every booked student needs a Hapana ID and full name. Collect again.');
        return{id,name};
      });
      if(new Set(students.map(student=>student.id)).size!==students.length)throw new Error('Duplicate student IDs in one class. Collect again.');
      return{hapanaSessionId:session.hapanaSessionId,sessionTitle:session.sessionTitle,tutorNameRaw:session.tutorNameRaw,startMinute:session.startMinute,endMinute:session.endMinute,students};
    });
    if(sessions.reduce((sum,session)=>sum+session.students.length,0)>5000)throw new Error('This collection has too many bookings to sync at once.');
    return{schemaVersion:2,date:core.date,captureId:core.captureId,mode:core.mode,sessions};
  }
  return{capture};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createFeedbackModel;
