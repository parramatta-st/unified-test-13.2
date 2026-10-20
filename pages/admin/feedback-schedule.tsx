import { useEffect, useState } from 'react';
import Header from '../../components/Header';
import useAuthGuard from '../../hooks/useAuthGuard';
import type { MatchReason, StudentSuggestion } from '../../lib/feedbackRollMatching';

type Booking = { source: string; name: string; target: string; sessionId: string; classLabel: string; reason: MatchReason; suggestions: StudentSuggestion[] };
type Overview = { date: string; lastSync: string; mode: string; sessions: number; instructors: { source: string; target: string; reason: MatchReason }[]; students: Booking[]; tutors: string[]; members: { id: string; name: string; year: string; parentName: string }[] };
type Group = Booking & { bookings: Booking[] };
function today() {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}
function groupBookings(bookings: Booking[]) {
  const groups = new Map<string, Group>();
  for (const booking of bookings) {
    const key = JSON.stringify([booking.source, booking.name, booking.target, booking.reason]);
    const existing = groups.get(key);
    if (existing) existing.bookings.push(booking);
    else groups.set(key, { ...booking, bookings: [booking] });
  }
  return [...groups.values()];
}
const explanations: Record<MatchReason, string> = {
  remembered: 'Remembered link', class_override: 'This class only', student_name: 'Student name matched', parent_name: 'Parent name matched', parent_first_name: 'Parent first name matched',
  tutor_name: 'Tutor name matched', tutor_first_name: 'First name matched', ambiguous_student: 'More than one student has this name — choose the correct student.',
  ambiguous_parent: 'This parent has multiple students — choose the child attending.', ambiguous_tutor: 'More than one tutor has this first name — choose the correct account.',
  needs_linking: 'Needs linking', saved_unavailable: 'The saved link is no longer active. Review this choice.',
};

export default function FeedbackScheduleSetup() {
  useAuthGuard();
  const [date, setDate] = useState(today), [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [classOnly, setClassOnly] = useState<Record<string, boolean>>({}), [chosenClass, setChosenClass] = useState<Record<string, string>>({});
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
  useEffect(() => { const controller = new AbortController(); setClassOnly({}); setChosenClass({}); void load(controller.signal); return () => controller.abort(); }, [date]);
  async function link(kind: 'tutor' | 'student', source: string, target: string, sessionId?: string, scope: 'class' | 'remember' = 'remember') {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/feedback-rolls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'link_identity', date, kind, source, target, sessionId, scope }) });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || 'The link was not saved.');
      await load(); setMessage(scope === 'class' ? 'Class link saved. Refresh the tutor’s Feedback page to use it.' : 'Link remembered for future collections. Refresh the tutor’s Feedback page to use it.');
    } catch (error) { setError(error instanceof Error ? error.message : 'The link was not saved.'); }
    finally { setBusy(false); }
  }
  const groups = groupBookings(data?.students || []), unresolved = groups.filter(group => !group.target), matched = groups.filter(group => group.target);
  const memberLabel = (member: Overview['members'][number]) => `${member.name}${member.year ? ` · ${member.year}` : ''}${member.parentName ? ` · Parent: ${member.parentName}` : ''} · ${member.id}`;
  function studentCard(group: Group) {
    const key = JSON.stringify([group.source, group.name, group.target, group.reason]);
    const onlyClass = classOnly[key] ?? group.reason === 'class_override';
    const sessionId = group.bookings.some(booking => booking.sessionId === chosenClass[key]) ? chosenClass[key] : group.sessionId;
    const options = group.suggestions.map(suggestion => ({ suggestion, member: data!.members.find(member => member.id === suggestion.id) })).filter(item => item.member !== undefined);
    const select = (target: string) => void link('student', group.source, target, sessionId, onlyClass ? 'class' : 'remember');
    return <div key={key} className={`roll-link-card${group.target ? '' : ' roll-link-review'}`}>
      <strong>{group.name}{!group.target ? ' · Needs linking' : ''}</strong>
      <p className="text-muted roll-link-note">{explanations[group.reason]}</p>
      {group.bookings.map(booking => <p key={booking.sessionId} className="text-muted roll-link-note">{booking.classLabel}</p>)}
      <label><span className="sr-only">Portal member for {group.name}</span><select className="input" aria-label={`Portal member for ${group.name} (${group.source}) · ${group.sessionId}`} value={group.target} disabled={busy} onChange={event => select(event.target.value)}>
        <option value="">Needs linking</option>
        {options.length > 0 && <optgroup label="Review suggestions">{options.map(({ member, suggestion }) => <option key={member!.id} value={member!.id}>{memberLabel(member!)} · {suggestion.via === 'parent' ? 'Parent name' : 'Student name'}</option>)}</optgroup>}
        <optgroup label="All active students">{data!.members.filter(member => !options.some(option => option.member!.id === member.id)).map(member => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</optgroup>
      </select></label>
      {!group.target && options.length > 0 && <p className="text-muted roll-link-note">{group.reason === 'needs_linking' ? 'Similar names found. Select the correct student to confirm; suggestions are not linked automatically.' : 'Select a student to confirm.'}</p>}
      <label className="roll-link-scope"><input type="checkbox" checked={!onlyClass} disabled={busy} onChange={event => setClassOnly(current => ({ ...current, [key]: !event.target.checked }))} />Remember for future bookings</label>
      <p className="text-muted roll-link-note">{onlyClass ? 'Applies to the selected dated class only.' : 'Applies to all bookings for this Hapana record. Turn off for a shared parent record that needs different children.'}</p>
      {onlyClass && group.bookings.length > 1 && <label>Class<select className="input" aria-label={`Class to link for ${group.name}`} value={sessionId} disabled={busy} onChange={event => setChosenClass(current => ({ ...current, [key]: event.target.value }))}>{group.bookings.map(booking => <option key={booking.sessionId} value={booking.sessionId}>{booking.classLabel}</option>)}</select></label>}
    </div>;
  }
  return <><Header /><main className="container"><div className="card">
    <h2 className="section-title">Daily Rolls → Feedback</h2>
    <p className="text-muted">Collect the day using Daily Rolls 0.6.1 or later. Tutor first names, student full names and unique parent names match automatically, including a parent’s first name when their surname is missing. Review only the bookings that need help.</p>
    <div className="feedback-schedule-toolbar"><label>Saved date<input className="input" type="date" aria-label="Saved date" value={date} disabled={busy} onChange={event => { const next = event.target.value; if (next !== date) { setData(null); setMessage(''); setDate(next); } }} /></label><button className="btn" disabled={busy} onClick={() => { setDate(today()); setMessage(''); }}>Today</button><button className="btn" disabled={busy} onClick={() => void load()}>{busy ? 'Loading…' : 'Refresh saved day'}</button></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {data && !data.lastSync && <p>No student bookings have synced for this day. Collect this date in the updated Daily Rolls extension, then refresh here.</p>}
    {data?.lastSync && <>
      <p role="status">{data.sessions} classes synced · {new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.lastSync))} · {data.mode === 'replace_day' ? 'Full day confirmed' : 'Visible classes updated; unseen classes retained'}</p>
      <section aria-labelledby="student-links-title"><h3 id="student-links-title">Needs linking ({unresolved.length})</h3>
        {unresolved.length ? <><p className="text-muted">Student name first, then parent name. Spelling suggestions and duplicate names need your review. Repeated bookings are grouped; a remembered choice links the record’s other bookings too.</p><div className="roll-link-grid">{unresolved.map(studentCard)}</div></> : <p>All student bookings are linked.</p>}
      </section>
      <h3>Instructor links</h3><p className="text-muted">Unique first names match automatically. Duplicate first names need review. Manual choices are remembered.</p>
      <div className="roll-link-grid">{data.instructors.map(instructor => <label key={instructor.source}>{instructor.source}{!instructor.target ? ' · Needs linking' : ''}<span className="text-muted">{explanations[instructor.reason]}</span><select className="input" aria-label={`Portal account for ${instructor.source}`} value={instructor.target} disabled={busy} onChange={event => void link('tutor', instructor.source, event.target.value)}><option value="">Needs linking</option>{data.tutors.map(tutor => <option key={tutor}>{tutor}</option>)}</select></label>)}</div>
      <details className="roll-matched"><summary>Matched students ({matched.length})</summary><p className="text-muted">Matched and remembered bookings are ready for Feedback. Expand a student to review or change the link. Parent contacts always come from the selected portal member.</p><div className="roll-link-grid">{matched.map(group => <details key={JSON.stringify([group.source, group.name, group.target, group.reason])}><summary>{group.name} → {data.members.find(member => member.id === group.target)?.name} · {explanations[group.reason]}</summary>{studentCard(group)}</details>)}</div></details>
      <p className="text-muted">Refresh the tutor’s Feedback page after linking. The My schedule switch appears only for tutors with a linked booking today. Recollect after substitutions or booking changes.</p>
    </>}
  </div></main></>;
}
