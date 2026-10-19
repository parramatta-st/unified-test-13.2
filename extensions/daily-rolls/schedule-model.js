/* Tutor-only schedule contract. No student records or payroll mutations. */
function createScheduleModel() {
  const SCHEMA = 1, MAX_SESSIONS = 500, MAX_REVISIONS = 50;
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const fail = message => { throw new Error(message); };
  const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  function instant(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`Invalid ${label}.`);
    return value;
  }
  function tutorName(value) {
    return clean(value).replace(/\s*\(\s*(?:sub|substitute)\s*\)$/i,'').trim();
  }
  function text(value, label, max=180) {
    if (typeof value !== 'string' || !clean(value) || value.length > max) fail(`Invalid ${label}.`);
    return clean(value);
  }
  function session(raw, date) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid session.');
    const id = text(raw.hapanaSessionId || raw.id, 'session ID', 80);
    if (!new RegExp(`^${date}:\\d+:\\d+$`).test(id)) fail('Session ID does not match the selected day.');
    const startMinute = raw.startMinute ?? raw.start, endMinute = raw.endMinute ?? raw.end;
    if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute) || startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) fail('Invalid session times.');
    const tutorNameRaw = text(raw.tutorNameRaw ?? raw.tutor, 'tutor name');
    const name = tutorName(tutorNameRaw);
    if (!name || /^(?:unassigned|not assigned|no instructor|tbc|tbd|none|n\/a|\(sub\))$/i.test(name)) fail('An assigned tutor is required.');
    // Construct a whitelist rather than persisting the original Hapana object.
    return {hapanaSessionId:id, sessionTitle:text(raw.sessionTitle ?? raw.name, 'session title'), tutorNameRaw, tutorName:name, startMinute, endMinute};
  }
  function validateCapture(raw) {
    if (!raw || raw.schemaVersion !== SCHEMA || raw.campusKey !== 'parramatta' || raw.timeZone !== 'Australia/Sydney' || !dateValid(raw.date)) fail('Unsupported schedule capture.');
    const captureId = text(raw.captureId,'capture ID',100);
    if (!/^[A-Za-z0-9_-]+$/.test(captureId)) fail('Invalid capture ID.');
    const startedAt=instant(raw.startedAt,'collection start'), completedAt=instant(raw.completedAt,'collection completion');
    if (completedAt < startedAt) fail('Collection completion precedes its start.');
    if (!['observed_sessions','replace_day'].includes(raw.mode)) fail('Invalid schedule mode.');
    if (!Array.isArray(raw.sessions) || raw.sessions.length > MAX_SESSIONS) fail('Too many sessions or invalid session list.');
    // The reader cannot prove an empty day loaded: do not clear old records this way.
    if (!raw.sessions.length) fail('An empty day cannot replace a saved schedule.');
    const sessions=raw.sessions.map(s=>session(s,raw.date)).sort((a,b)=>a.startMinute-b.startMinute || a.hapanaSessionId.localeCompare(b.hapanaSessionId));
    if (new Set(sessions.map(s=>s.hapanaSessionId)).size !== sessions.length) fail('Duplicate session IDs.');
    if (!Number.isInteger(raw.excludedSessionCount) || raw.excludedSessionCount < 0 || raw.excludedSessionCount > MAX_SESSIONS) fail('Invalid excluded-session count.');
    return {schemaVersion:SCHEMA,campusKey:'parramatta',timeZone:'Australia/Sydney',date:raw.date,captureId,startedAt,completedAt,mode:raw.mode,scope:'included_group_classes',excludedSessionCount:raw.excludedSessionCount,sessions};
  }
  function capture({day,sessions,errors=[],collecting=false,demo=false,startedAt,completedAt,captureId,fullDay=false}) {
    if (demo) fail('Demo data is never saved.');
    if (collecting || errors.length) fail('Finish and verify every class before saving the schedule.');
    if (!day || !Array.isArray(day.sessions) || !Array.isArray(day.excluded)) fail('No verified day is available.');
    const expected=new Set(day.sessions.map(s=>s.id));
    if (expected.size !== day.sessions.length || expected.size !== sessions.length || sessions.some(s=>!expected.has(s.id))) fail('The collected sessions do not match the selected day.');
    return validateCapture({schemaVersion:SCHEMA,campusKey:'parramatta',timeZone:'Australia/Sydney',date:day.date,captureId,startedAt,completedAt,mode:fullDay?'replace_day':'observed_sessions',excludedSessionCount:day.excluded.length,sessions});
  }
  function apply(previous, incoming) {
    const next=validateCapture(incoming);
    if (previous && (previous.schemaVersion !== SCHEMA || previous.date !== next.date || previous.campusKey !== next.campusKey || !Array.isArray(previous.revisions))) fail('Stored schedule needs checking. It was not overwritten.');
    const history=previous?.revisions || [];
    const replay=history.find(r=>r.capture.captureId===next.captureId);
    if (replay) {
      if (JSON.stringify(replay.capture)!==JSON.stringify(next)) fail('The capture ID was reused with different data.');
      return {record:previous,replayed:true};
    }
    // A collection started earlier may finish later. Never let it reverse a newer substitution.
    if (previous && next.startedAt <= previous.lastStartedAt) fail('A newer collection is already saved. Collect this day again.');
    const before=new Map((previous?.sessions||[]).map(s=>[s.hapanaSessionId,s]));
    const merged=next.mode==='replace_day'?new Map():new Map(before);
    for (const s of next.sessions) merged.set(s.hapanaSessionId,{...s,observedAt:next.completedAt});
    if (merged.size>MAX_SESSIONS) fail('The saved day has too many sessions.');
    const changes=[];
    for (const s of next.sessions) {
      const old=before.get(s.hapanaSessionId);
      if (!old) changes.push({type:'added',hapanaSessionId:s.hapanaSessionId,after:s});
      else {
        const core=({observedAt,...rest})=>rest;
        if (JSON.stringify(core(old))!==JSON.stringify(s)) changes.push({type:old.tutorName!==s.tutorName?'tutor_changed':'session_changed',hapanaSessionId:s.hapanaSessionId,before:core(old),after:s});
      }
    }
    if (next.mode==='replace_day') for (const [id,old] of before) if (!merged.has(id)) {
      const {observedAt,...core}=old;changes.push({type:'removed',hapanaSessionId:id,before:core});
    }
    const revision=(previous?.revision||0)+1;
    const revisions=[...history,{revision,capture:next,changes}].slice(-MAX_REVISIONS);
    return {replayed:false,record:{schemaVersion:SCHEMA,campusKey:next.campusKey,timeZone:next.timeZone,date:next.date,revision,lastStartedAt:next.startedAt,updatedAt:next.completedAt,lastMode:next.mode,scope:next.scope,excludedSessionCount:next.excludedSessionCount,sessions:[...merged.values()].sort((a,b)=>a.startMinute-b.startMinute||a.hapanaSessionId.localeCompare(b.hapanaSessionId)),revisions,historyTruncated:(previous?.historyTruncated||false)||history.length>=MAX_REVISIONS}};
  }
  return {SCHEMA,MAX_SESSIONS,MAX_REVISIONS,dateValid,tutorName,validateCapture,capture,apply};
}
if (typeof module !== 'undefined' && module.exports) module.exports=createScheduleModel;
