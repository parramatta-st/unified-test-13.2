import { useEffect, useState } from 'react';
import Header from '../../components/Header';
import useAuthGuard from '../../hooks/useAuthGuard';

type Overview = { date: string; lastSync: string; mode: string; sessions: number; instructors: { source: string; target: string }[]; students: { source: string; name: string; target: string }[]; tutors: string[]; members: { id: string; name: string; year: string; parentName: string }[] };
function today() {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
export default function FeedbackScheduleSetup() {
  useAuthGuard();
  const [date, setDate] = useState(today), [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function load(signal?: AbortSignal) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/feedback-rolls?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load Daily Rolls.');
      if (!signal?.aborted) setData(json);
    } catch (error) { if (!signal?.aborted) { setData(null); setError(error instanceof Error ? error.message : 'Could not load Daily Rolls.'); } }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [date]);
  async function link(kind: 'tutor' | 'student', source: string, target: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/feedback-rolls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'link_identity', date, kind, source, target }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'The link was not saved.');
      await load(); setMessage('Link saved. Refresh the tutor’s Feedback page to use it.');
    } catch (error) { setError(error instanceof Error ? error.message : 'The link was not saved.'); }
    finally { setBusy(false); }
  }
  return <><Header /><main className="container"><div className="card">
    <h2 className="section-title">Daily Rolls → Feedback</h2>
    <p className="text-muted">1. Sign in here as an admin in the same Chrome profile as Hapana. 2. Collect the day using Daily Rolls 0.6.0 or later. 3. Link any names below.</p>
    <div className="feedback-schedule-toolbar"><label>Saved date<input className="input" type="date" aria-label="Saved date" value={date} disabled={busy} onChange={event => { setData(null); setMessage(''); setDate(event.target.value); }} /></label><button className="btn" disabled={busy} onClick={() => { setDate(today()); setMessage(''); }}>Today</button><button className="btn" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Refresh saved day'}</button></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && !data.lastSync && <p>No student bookings have synced for this day. Collect this date in the updated Daily Rolls extension, then refresh here.</p>}
    {data?.lastSync && <>
      <p role="status">{data.sessions} classes synced · {new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.lastSync))} · {data.mode === 'replace_day' ? 'Full day confirmed' : 'Visible classes updated; unseen classes retained'}</p>
      <h3>Link instructor names</h3><p className="text-muted">For example, select the portal account “Sai” beside “Sai Arulanathan”. Links are remembered for future collections. First names are never guessed.</p>
      <div className="roll-link-grid">{data.instructors.map(instructor => <label key={instructor.source}>{instructor.source}<select className="input" aria-label={`Portal account for ${instructor.source}`} value={instructor.target} disabled={busy} onChange={event => void link('tutor', instructor.source, event.target.value)}><option value="">Needs linking</option>{data.tutors.map(tutor => <option key={tutor}>{tutor}</option>)}</select></label>)}</div>
      <h3>Student links</h3><p className="text-muted">Exact, unique full names link automatically. Check any unmatched names or duplicates against the portal’s Members list. Parent contact details always come from the linked member.</p>
      <div className="roll-link-grid">{data.students.map(student => <label key={student.source}>{student.name}{!student.target ? ' · Needs linking' : ''}<select className="input" aria-label={`Portal member for ${student.name} (${student.source})`} value={student.target} disabled={busy} onChange={event => void link('student', student.source, event.target.value)}><option value="">Needs linking</option>{data.members.map(member => <option key={member.id} value={member.id}>{member.name}{member.year ? ` · ${member.year}` : ''}{member.parentName ? ` · ${member.parentName}` : ''} · {member.id}</option>)}</select></label>)}</div>
      <p className="text-muted">The My schedule switch appears only for tutors with a linked booking today. Tutors can still choose All students. Regenerate rolls after substitutions or booking changes. This connection does not change time-clock or payroll records.</p>
    </>}
  </div></main></>;
}
