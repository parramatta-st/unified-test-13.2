import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StudentPickerValue } from './StudentPicker';

function today() {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
export default function FeedbackStudentMode({ children, onSelect, selected }: { children: ReactNode; onSelect: (student: StudentPickerValue) => void; selected: string }) {
  const [mode, setMode] = useState<'schedule' | 'all'>('schedule');
  const [ready, setReady] = useState(false);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const preference = useRef('');
  useEffect(() => {
    let live = true;
    void fetch('/api/admin-status', { cache: 'no-store' }).then(response => response.json()).then(auth => {
      if (!live) return;
      if (auth.authed) {
        preference.current = `st_feedback_student_mode:${auth.campus}|${auth.tutor}`;
        try { const saved = localStorage.getItem(preference.current); if (saved === 'all' || saved === 'schedule') setMode(saved); } catch {}
      }
    }).catch(() => {}).finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!ready || mode !== 'schedule') return;
    let live = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    setLoading(true); setError(''); setData(null);
    void fetch(`/api/feedback-schedule?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'Your schedule is unavailable.');
      if (live) setData(json);
    }).catch(error => { if (live) setError(error?.message || 'Your schedule is unavailable.'); })
      .finally(() => { clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [mode, date, ready, refresh]);
  function change(next: 'schedule' | 'all') {
    setMode(next);
    if (preference.current) try { localStorage.setItem(preference.current, next); } catch {}
  }
  return <section className="feedback-student-mode" aria-label="Choose feedback student">
    <div className="segmented feedback-student-switch">
      <button type="button" className={`seg-btn ${mode === 'schedule' ? 'active' : ''}`} aria-pressed={mode === 'schedule'} onClick={() => change('schedule')} disabled={!ready}>My schedule</button>
      <button type="button" className={`seg-btn ${mode === 'all' ? 'active' : ''}`} aria-pressed={mode === 'all'} onClick={() => change('all')} disabled={!ready}>All students</button>
    </div>
    {selected && <p className="feedback-schedule-selected">Selected student: <strong>{selected}</strong></p>}
    {mode === 'all' ? children : <>
      <div className="feedback-schedule-toolbar"><label>Date <input className="input" aria-label="Schedule date" type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button type="button" className="btn" onClick={() => setDate(today())}>Today</button><button type="button" className="btn" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh schedule</button></div>
      {(loading || !ready) && <p role="status">Loading your students…</p>}
      {error && <p role="status">{error}</p>}
      {!loading && !error && data && !data.configured && <p>Your schedule has not been connected yet. Choose All students to give feedback.</p>}
      {!loading && !error && data?.configured && !data.sessions?.length && <p>No students are scheduled for this day. You can use All students.</p>}
      {(data?.sessions || []).map((session: any) => <div className="feedback-schedule-session" key={session.key}><strong>{session.startLabel}–{session.endLabel}</strong><div className="feedback-schedule-students">{session.students.map((student: any) => {
        const usable = student.memberMatched && student.email && student.lastName;
        return <button type="button" key={student.id || student.name} className={`btn ${selected === student.name ? 'selected' : ''}`} disabled={!usable} onClick={() => onSelect(student)} title={usable ? student.name : 'This booking needs a linked student with surname and parent email.'}>{student.name}{student.isMakeup ? ' · Makeup' : ''}{!usable ? ' · Needs student setup' : ''}</button>;
      })}</div></div>)}
    </>}
  </section>;
}
