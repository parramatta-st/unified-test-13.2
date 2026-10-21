function createRollModel() {
  const rooms = ['1','2','3','4'];
  const overlap = (a,b) => a.start < b.end && b.start < a.end;
  function tutorClasses(sessions) {
    const buckets = new Map(), result = [];
    sessions.forEach((session,index) => {
      const tutor = tutorName(session.tutor).toLocaleLowerCase('en-AU');
      const key = tutor ? JSON.stringify([session.date || '', session.campus || '', tutor]) : `unknown:${index}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(session);
    });
    for (const bucket of buckets.values()) {
      let group;
      for (const session of [...bucket].sort((a,b)=>a.start-b.start||String(a.id).localeCompare(String(b.id)))) {
        // Adjacent hours can use different rooms. Overlap chains must move
        // together: a longer class can link two otherwise adjacent classes.
        if (!group || session.start >= group.end) {
          group = {id:session.id,start:session.start,end:session.end,sessions:[]};
          result.push(group);
        }
        group.sessions.push(session); group.end=Math.max(group.end,session.end);
      }
    }
    return result;
  }
  function suggest(sessions, {preserve=false}={}) {
    const primary = group => group.sessions.some(s=>/K\s*[-–]\s*6/i.test(s.name));
    const senior = group => group.sessions.some(s=>/7\s*[-–]\s*10/.test(s.name));
    const bookingCount = group => group.sessions.reduce((total,s)=>total+(Number.isFinite(Number(s.booked))?Number(s.booked):Array.isArray(s.students)?s.students.length:0),0);
    const groups = tutorClasses(sessions);
    // A retry keeps an existing room for the entire tutor group, including
    // newly recovered classes. Reserve these rooms before placing new groups.
    const placed = preserve ? groups.flatMap(group=>{
      const room=group.sessions.find(s=>rooms.includes(s.room))?.room;
      return room ? [{...group,room}] : [];
    }) : [];
    const fixed = new Set(placed.map(group=>group.id));
    const sorted = groups.filter(group=>!fixed.has(group.id)).sort((a,b)=>a.start-b.start||Number(senior(b))-Number(senior(a))||(primary(a)&&primary(b)?bookingCount(b)-bookingCount(a):0)||String(a.id).localeCompare(String(b.id)));
    for (const s of sorted) {
      let room = '';
      if (senior(s)) room = '1';
      else if (primary(s)) {
        room = ['2','3','4'].sort((a,b) => placed.filter(p=>p.room===a&&overlap(p,s)).length-placed.filter(p=>p.room===b&&overlap(p,s)).length || Number(a)-Number(b))[0];
      }
      placed.push({...s,room});
    }
    const allocations = new Map(placed.flatMap(group=>group.sessions.map(s=>[s.id,group.room])));
    return sessions.map(s=>({...s,room:allocations.get(s.id)}));
  }
  function assignRoom(sessions,id,room) {
    if (room!==''&&!rooms.includes(room)) return sessions;
    const linked=tutorClasses(sessions).find(group=>group.sessions.some(s=>s.id===id));
    if (!linked) return sessions;
    const ids=new Set(linked.sessions.map(s=>s.id));
    return sessions.map(s=>ids.has(s.id)?{...s,room}:s);
  }
  function validate(sessions, errors, collecting) {
    if (collecting) return 'Collection is still running.';
    if (errors.length) return 'Resolve collection errors before printing. Incomplete rolls are blocked.';
    if (!sessions.length) return 'No included group classes have been collected.';
    if (sessions.some(s=>!rooms.includes(s.room))) return 'Choose a room for every class before printing.';
    const conflict=tutorClasses(sessions).find(group=>new Set(group.sessions.map(s=>s.room)).size>1);
    if (conflict) return `Overlapping classes for ${tutorName(conflict.sessions[0].tutor)} must share one room. Choose a room for either class to move them together.`;
    return '';
  }
  const formatTime = minutes => `${minutes % 720 < 60 ? 12 : Math.floor(minutes % 720 / 60)}:${String(minutes % 60).padStart(2,'0')} ${minutes < 720 ? 'am' : 'pm'}`;
  const fullDate = date => new Intl.DateTimeFormat('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
  function tutorName(value) {
    const original=String(value||'').trim().replace(/\s+/g,' ');
    // Hapana appends this status to the same instructor's name. Strip only a
    // recognised trailing status, never arbitrary brackets or parts of a name.
    return original.replace(/\s*\(\s*(?:sub|substitute)\s*\)$/i,'').trim()||original;
  }
  function groups(sessions, kind) {
    const order=(a,b)=>a.start-b.start||a.name.localeCompare(b.name);
    if(kind==='rooms')return rooms.map(key=>({key,label:`Room ${key}`,sessions:sessions.filter(s=>s.room===key).sort(order)})).filter(g=>g.sessions.length);
    const tutors=new Map();
    for(const session of sessions) {
      const label=tutorName(session.tutor),key=label.toLocaleLowerCase('en-AU');
      if(!tutors.has(key))tutors.set(key,{key,label,sessions:[]});
      tutors.get(key).sessions.push(session);
    }
    return [...tutors.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(g=>({...g,sessions:g.sessions.sort(order)}));
  }
  return {rooms,overlap,suggest,assignRoom,validate,formatTime,fullDate,tutorName,groups};
}
if (typeof module !== 'undefined' && module.exports) module.exports = createRollModel;
