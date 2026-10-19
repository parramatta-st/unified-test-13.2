import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StudentPickerValue } from './StudentPicker';
import type { feedbackScheduleSessions } from '../lib/feedbackSchedule';

type Schedule = { configured: boolean; sessions: ReturnType<typeof feedbackScheduleSessions> };

async function loadSchedule(date: string, signal: AbortSignal): Promise<Schedule> {
  const response = await fetch(`/api/feedback-schedule?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(json.error || 'Your schedule is unavailable.');
  return json;
}

function today() {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
export default function FeedbackStudentMode({ children, onSelect, selected }: { children: ReactNode; onSelect: (student: StudentPickerValue) => void; selected: string }) {
  const [mode, setMode] = useState<'schedule' | 'all'>('schedule');
  const [ready, setReady] = useState(false);
  const [date, setDate] = useState(today);
  const [currentDay, setCurrentDay] = useState(today);
  const [todayData, setTodayData] = useState<Schedule | null>(null);
  const [dateData, setDateData] = useState<Schedule | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingToday, setCheckingToday] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const preference = useRef('');
  const hasBookingToday = !!todayData?.configured && !!todayData.sessions.length;
  const showSchedule = hasBookingToday && mode === 'schedule';
  const data = date === currentDay ? todayData : dateData;
  const busy = date === currentDay ? checkingToday : loading;
  const dateError = date === currentDay ? '' : error;
  useEffect(() => {
    function checkDay() {
      const next = today();
      if (next !== currentDay) {
        setTodayData(null); setCurrentDay(next); setDate(next);
      }
    }
    const timer = setInterval(checkDay, 60000);
    document.addEventListener('visibilitychange', checkDay);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', checkDay); };
  }, [currentDay]);
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
    if (!ready) return;
    let live = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    setCheckingToday(true);
    // Check today's authenticated roster even when All students was remembered.
    // No booking, missing setup or a failed request leaves the normal picker usable.
    void loadSchedule(currentDay, controller.signal).then(json => {
      if (live) setTodayData(json);
    }).catch(() => { if (live) setTodayData(null); })
      .finally(() => { clearTimeout(timer); if (live) setCheckingToday(false); });
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [currentDay, ready, refresh]);
  useEffect(() => {
    if (!ready || !showSchedule || date === currentDay) return;
    let live = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    setLoading(true); setError(''); setDateData(null);
    void loadSchedule(date, controller.signal).then(json => {
      if (live) setDateData(json);
    }).catch(error => { if (live) setError(error?.message || 'Your schedule is unavailable.'); })
      .finally(() => { clearTimeout(timer); if (live) setLoading(false); });
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [showSchedule, currentDay, date, ready, refresh]);
  function change(next: 'schedule' | 'all') {
    setMode(next);
    if (preference.current) try { localStorage.setItem(preference.current, next); } catch {}
  }
  return <>
    <div className="feedback-heading">
      <h2 className="section-title">Parent Feedback</h2>
      {hasBookingToday && <div className="segmented feedback-student-switch" role="group" aria-label="Student view">
      <button type="button" className={`seg-btn ${mode === 'schedule' ? 'active' : ''}`} aria-pressed={mode === 'schedule'} onClick={() => change('schedule')} disabled={!ready}>My schedule</button>
      <button type="button" className={`seg-btn ${mode === 'all' ? 'active' : ''}`} aria-pressed={mode === 'all'} onClick={() => change('all')} disabled={!ready}>All students</button>
      </div>}
    </div>
    <p className="text-muted">Choose a student, then prepare their feedback.</p>
    {showSchedule ? <section className="feedback-student-mode" aria-label="Choose feedback student">
      {selected && <p className="feedback-schedule-selected">Selected student: <strong>{selected}</strong></p>}
      <div className="feedback-schedule-toolbar"><label>Date <input className="input" aria-label="Schedule date" type="date" value={date} onChange={event => { setDateData(null); setError(''); setDate(event.target.value); }} /></label><button type="button" className="btn" onClick={() => setDate(currentDay)}>Today</button><button type="button" className="btn" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh schedule</button></div>
      {busy && <p role="status">Loading your students…</p>}
      {dateError && <p role="status">{dateError}</p>}
      {!busy && !dateError && data && !data.configured && <p>Your schedule has not been connected yet. Choose All students to give feedback.</p>}
      {!busy && !dateError && data?.configured && !data.sessions?.length && <p>No students are scheduled for this day. You can use All students.</p>}
      {(data?.sessions || []).map(session => <div className="feedback-schedule-session" key={session.key}><strong>{session.startLabel}–{session.endLabel}</strong><div className="feedback-schedule-students">{session.students.map(student => {
        const usable = student.memberMatched && student.email && student.lastName;
        return <button type="button" key={student.id || student.name} className={`btn ${selected === student.name ? 'selected' : ''}`} disabled={!usable} onClick={() => onSelect(student)} title={usable ? student.name : 'This booking needs a linked student with surname and parent email.'}>{student.name}{student.isMakeup ? ' · Makeup' : ''}{!usable ? ' · Needs student setup' : ''}</button>;
      })}</div></div>)}
    </section> : children}
  </>;
}
