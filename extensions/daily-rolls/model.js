function createRollModel() {
  const rooms = ['1','2','3','4'];
  const overlap = (a,b) => a.start < b.end && b.start < a.end;
  function suggest(sessions) {
    const placed = [];
    const primary = s => /K\s*[-–]\s*6/i.test(s.name);
    const bookingCount = s => Number.isFinite(Number(s.booked)) ? Number(s.booked) : Array.isArray(s.students) ? s.students.length : 0;
    const sorted = [...sessions].sort((a,b) => a.start-b.start || (/7\s*[-–]\s*10/.test(b.name)?1:0) - (/7\s*[-–]\s*10/.test(a.name)?1:0) || (primary(a)&&primary(b)?bookingCount(b)-bookingCount(a):0) || a.id.localeCompare(b.id));
    for (const s of sorted) {
      let room = '';
      if (/7\s*[-–]\s*10/.test(s.name)) room = '1';
      else if (primary(s)) {
        room = ['2','3','4'].sort((a,b) => placed.filter(p=>p.room===a&&overlap(p,s)).length-placed.filter(p=>p.room===b&&overlap(p,s)).length || Number(a)-Number(b))[0];
      }
      placed.push({...s,room});
    }
    const allocations = new Map(placed.map(s=>[s.id,s.room]));
    return sessions.map(s=>({...s,room:allocations.get(s.id)}));
  }
  function validate(sessions, errors, collecting) {
    if (collecting) return 'Collection is still running.';
    if (errors.length) return 'Resolve collection errors before printing. Incomplete rolls are blocked.';
    if (!sessions.length) return 'No included group classes have been collected.';
    if (sessions.some(s=>!rooms.includes(s.room))) return 'Choose a room for every class before printing.';
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
  return {rooms,overlap,suggest,validate,formatTime,fullDate,tutorName,groups};
}
if (typeof module !== 'undefined' && module.exports) module.exports = createRollModel;
