import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { checkShiftEntry, localShiftInput, parseTimeEntry, formatTimeEntry } from '../lib/timeClockEntry';
import { combinedPremiumHours } from '../lib/timeClockPayroll';
import { splitPaidHours, sydneyDateKey, addCalendarDays } from '../lib/timeClockCore';

export type EditableClockShift = {
  shiftId: string;
  tutorName: string;
  clockIn: string;
  clockOut: string;
  version: number;
};

type Props = {
  mode: 'create' | 'edit' | 'void' | 'approve';
  tutors: string[];
  initialTutor?: string;
  initialDate?: string;
  shift?: EditableClockShift | null;
  onClose: () => void;
  onSaved: (result: { message: string; shift: EditableClockShift | null }) => void;
};

export default function TimeClockShiftDialog({ mode, tutors, initialTutor, initialDate, shift, onClose, onSaved }: Props) {
  const id = useId();
  const initialStart = shift ? localShiftInput(shift.clockIn) : '';
  const initialEnd = shift ? localShiftInput(shift.clockOut) : '';
  const wasOvernight = !!initialEnd && initialStart.slice(0, 10) !== initialEnd.slice(0, 10);
  const [tutor, setTutor] = useState(shift?.tutorName || initialTutor || '');
  const [date, setDate] = useState(initialStart.slice(0, 10) || initialDate || sydneyDateKey(Date.now()));
  const [startTime, setStartTime] = useState(formatTimeEntry(initialStart.slice(11)));
  // Never silently convert an existing overnight shift into a same-day shift.
  const [endTime, setEndTime] = useState(wasOvernight ? '' : formatTimeEntry(initialEnd.slice(11)));
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  function close() {
    if (!savingRef.current) onClose();
  }

  function submittedInstant(local: string, original: string | undefined) {
    // Preserve seconds and the DST offset if an existing displayed time is unchanged.
    return original && local === localShiftInput(original) ? original : local;
  }

  const startParsed = parseTimeEntry(startTime), endParsed = parseTimeEntry(endTime);
  const clockIn = startParsed && date ? submittedInstant(`${date}T${startParsed}`, shift?.clockIn) : '';
  const clockOut = endParsed && date ? submittedInstant(`${date}T${endParsed}`, shift?.clockOut) : '';
  const requireEnd = mode === 'create' || mode === 'approve' || wasOvernight;
  const checked = mode === 'void' ? null : startTime && !startParsed
    ? { ok: false as const, error: 'Start time: enter a time such as 4pm, 4:30 pm or 16:30.' }
    : endTime && !endParsed ? { ok: false as const, error: 'End time: enter a time such as 8pm, 8:30 pm or 20:30.' }
    : checkShiftEntry(clockIn, clockOut, requireEnd);
  const showTimeError = !!checked && checked.ok === false && (attempted || (!!date && !!startTime && !!endTime));
  const hours = checked?.ok && checked.endMs !== null
    ? splitPaidHours(checked.startMs, checked.endMs) : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    setAttempted(true);
    setError('');
    if (!['void', 'approve'].includes(mode) && checked && checked.ok === false) {
      setError(checked.error);
      return;
    }
    if (mode === 'create' && !tutor) {
      setError('Choose the team member who worked this shift.');
      return;
    }
    if (['edit', 'void'].includes(mode) && !reason.trim()) {
      setError('Enter a written reason for this correction.');
      return;
    }
    const payload = {
      action: mode === 'create' ? 'create_shift' : mode === 'edit' ? 'edit_shift' : mode === 'approve' ? 'approve_shift' : 'void_shift',
      shiftId: shift?.shiftId || '',
      version: shift?.version || '',
      tutorName: tutor,
      clockIn: ['void', 'approve'].includes(mode) ? '' : clockIn,
      clockOut: ['void', 'approve'].includes(mode) ? '' : clockOut,
      notes: mode === 'create' ? notes : '',
      reason: mode === 'create' ? '' : reason,
    };
    const signature = JSON.stringify(payload);
    if (!pending.current || pending.current.signature !== signature) {
      pending.current = {
        signature,
        requestId: `admin_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`,
      };
    }
    savingRef.current = true;
    setSaving(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    let saved: { message: string; shift: EditableClockShift | null } | null = null;
    try {
      const response = await fetch('/api/admin/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId: pending.current.requestId }),
        signal: controller.signal,
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok === false || !json?.ok) {
        if (response.status < 500) pending.current = null;
        throw new Error(json?.error || 'Could not save this shift. Please try again.');
      }
      pending.current = null;
      saved = { message: json.message || 'Time Clock updated.', shift: json.shift || null };
    } catch (saveError: unknown) {
      setError(saveError instanceof Error && saveError.name === 'AbortError'
        ? 'The server took too long to confirm the save. Retry with the same details; the request is protected against duplicates.'
        : saveError instanceof Error ? saveError.message : 'Could not save this shift. Please try again.');
    } finally {
      window.clearTimeout(timeout);
      savingRef.current = false;
      setSaving(false);
    }
    if (saved) {
      window.dispatchEvent(new Event('st-time-clock-refresh'));
      onSaved(saved);
    }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="tc-entry-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div
        ref={dialogRef} className="tc-entry-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`} tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); close(); }
          if (event.key === 'Tab') {
            const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []);
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first?.focus();
            }
          }
        }}
      >
        <div className="tc-entry-head">
          <div>
            <div className="eyebrow">Success Tutoring</div>
            <h2 id={`${id}-title`}>{mode === 'create' ? 'Add manual entry' : mode === 'edit' ? `Edit ${tutor}’s shift` : mode === 'approve' ? `Approve ${tutor}’s hours` : `Void ${tutor}’s shift`}</h2>
          </div>
          <button className="tc-entry-close" type="button" onClick={close} disabled={saving} aria-label="Close manual entry">×</button>
        </div>
        <form onSubmit={save} noValidate>
          <fieldset disabled={saving}>
            {mode === 'approve' && <div className="tc-entry-duration"><strong>{tutor} · {initialStart.slice(0, 10)}</strong><p>{formatTimeEntry(initialStart.slice(11))} – {formatTimeEntry(initialEnd.slice(11))}</p><p>Confirm these recorded times are correct. Approval is audited; changing the times later requires a new approval.</p></div>}
            {!['void', 'approve'].includes(mode) && <>
              <div className="tc-entry-grid">
                <label>
                  <span>Team member</span>
                  {mode === 'create'
                    ? <select className="input" value={tutor} onChange={(event) => setTutor(event.target.value)}>
                        <option value="" disabled>Choose a team member</option>
                        {tutors.map((name) => <option key={name}>{name}</option>)}
                      </select>
                    : <div className="tc-entry-person">{tutor}</div>}
                </label>
                <label><span>Shift date</span><input className="input" type="date" required max={sydneyDateKey(Date.now())} value={date} onChange={(event) => { setDate(event.target.value); setError(''); }} /><span className="tc-entry-shortcuts"><button type="button" onClick={() => { setDate(sydneyDateKey(Date.now())); setError(''); }}>Today</button><button type="button" onClick={() => { setDate(addCalendarDays(sydneyDateKey(Date.now()), -1)); setError(''); }}>Yesterday</button></span></label>
                <label><span>Start time</span><input className="input" type="text" inputMode="text" autoComplete="off" placeholder="e.g. 4pm" required value={startTime} onChange={(event) => { setStartTime(event.target.value); setError(''); }} onBlur={() => setStartTime(formatTimeEntry(startTime))} /></label>
                <label><span>End time{!requireEnd && ' (blank if still open)'}</span><input className="input" type="text" inputMode="text" autoComplete="off" placeholder="e.g. 8pm" required={requireEnd} value={endTime} onChange={(event) => { setEndTime(event.target.value); setError(''); }} onBlur={() => setEndTime(formatTimeEntry(endTime))} /></label>
              </div>
              <p className="tc-entry-help">Type 4pm, 4:30 pm or 16:30. Both times use the selected date in Sydney.</p>
              {mode === 'create' && <div className="tc-entry-shortcuts" aria-label="Common shift times"><span>Fill times:</span>{[['4–7 pm','16:00','19:00'],['4–8 pm','16:00','20:00'],['10 am–2 pm','10:00','14:00']].map(([label,start,end]) => <button key={label} type="button" onClick={() => { setStartTime(formatTimeEntry(start)); setEndTime(formatTimeEntry(end)); setError(''); }}>{label}</button>)}</div>}
              {wasOvernight && <p className="tc-entry-warning">This recorded shift crosses midnight. Enter the correct same-day end time. Its original dates will remain in the adjustment history.</p>}
              {showTimeError && <p className="tc-entry-warning" role="alert">{checked && checked.ok === false ? checked.error : ''}</p>}
              <div className="tc-entry-duration" aria-live="polite">
                <strong>{hours ? `Total time: ${Math.floor(hours.elapsedMinutes / 60)}h ${hours.elapsedMinutes % 60}m` : checked?.ok && !requireEnd ? 'Open shift — excluded from payroll until clocked out' : 'Enter the date and times to see hours'}</strong>
                {hours && <div className="tc-entry-bands">
                  <span>Normal <b>{hours.normalHours.toFixed(2)} h</b></span>
                  <span>After 7 PM + Saturday <b>{combinedPremiumHours(hours).toFixed(2)} h</b></span>
                </div>}
                {!!hours?.unclassifiedMinutes && <p className="tc-entry-warning">{hours.unclassifiedHours.toFixed(2)} h on Sunday need a pay category review.</p>}
              </div>
            </>}
            {mode === 'create' ? (
              <label className="tc-entry-notes"><span>Notes (optional)</span><textarea className="input" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Any useful context about the missed shift." /></label>
            ) : (
              <label className="tc-entry-notes"><span>{mode === 'approve' ? 'Approval note (optional)' : 'Reason (required)'}</span><textarea className="input" maxLength={1000} value={reason} onChange={(event) => { setReason(event.target.value); setError(''); }} placeholder={mode === 'void' ? 'Why should this shift be voided?' : mode === 'approve' ? 'Any useful context about these hours.' : 'Why do these times need correcting?'} /></label>
            )}
          </fieldset>
          <p className="tc-entry-help">{mode === 'create' ? 'Your admin name and the time this entry was added are recorded automatically.' : mode === 'void' ? 'The shift remains in the audit history as Voided and contributes no payroll hours.' : 'The original times, your admin name, and this reason are retained in the adjustment history.'}</p>
          {error && <div ref={errorRef} className="tc-entry-error" role="alert">{error}</div>}
          <div className="tc-entry-actions">
            <button className="btn" type="button" onClick={close} disabled={saving}>Cancel</button>
            <button className={`btn-primary ${mode === 'void' ? 'tc-entry-danger' : ''}`} type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'create' ? 'Save entry' : mode === 'edit' ? 'Save changes' : mode === 'approve' ? 'Approve hours' : 'Void shift'}</button>
          </div>
        </form>
      </div>
      <style jsx>{`
        .tc-entry-backdrop{position:fixed;inset:0;z-index:5200;background:rgba(0,0,0,.76);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto}
        .tc-entry-dialog{width:min(620px,100%);max-height:calc(100vh - 2rem);max-height:calc(100dvh - 2rem);overflow:auto;overscroll-behavior:contain;background:radial-gradient(600px 250px at 50% 0%,rgba(49,200,255,.07),transparent 65%),#0b0d12;border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:1.2rem;box-shadow:0 35px 100px rgba(0,0,0,.7);color:#e9eef6}
        .tc-entry-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.7rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,.1)}h2{margin:.25rem 0 0;font-size:1.4rem;overflow-wrap:anywhere}
        .tc-entry-close{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:inherit;font-size:1.3rem;cursor:pointer}
        fieldset{border:0;padding:0;margin:0;min-width:0}.tc-entry-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.9rem;margin-top:1rem}label{display:block;min-width:0}label>span{display:block;font-size:.8rem;color:#b1bdcd;margin-bottom:.4rem}input,select,textarea{width:100%;min-width:0;max-width:100%;box-sizing:border-box;font-size:16px;color-scheme:dark}.tc-entry-person{padding:.7rem 0;font-weight:650}.tc-entry-notes{margin-top:1rem}.tc-entry-notes textarea{min-height:74px;resize:vertical}
        .tc-entry-shortcuts{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;margin:.5rem 0;font-size:.75rem}.tc-entry-shortcuts button{border:1px solid rgba(49,200,255,.22);background:rgba(49,200,255,.06);color:#bdefff;border-radius:8px;padding:.4rem .6rem;cursor:pointer;min-height:32px}
        .tc-entry-help{font-size:.75rem;line-height:1.5;color:#8f9eb0;margin:.7rem 0}.tc-entry-warning{color:#fde68a;font-size:.8rem;line-height:1.5}.tc-entry-duration{padding:.9rem;border:1px solid rgba(49,200,255,.16);border-radius:14px;background:rgba(49,200,255,.04);font-size:.85rem}.tc-entry-bands{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;margin-top:.8rem;color:#9eaec1;font-size:.72rem}.tc-entry-bands b{display:block;margin-top:.15rem;font-size:.9rem;color:#e7edf6}.tc-entry-bands span:nth-child(2) b{color:#7dd3fc}.tc-entry-bands span:nth-child(3) b{color:#fdba74}
        .tc-entry-error{padding:.8rem;border-radius:12px;color:#fecaca;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.24);font-size:.82rem;line-height:1.5}.tc-entry-actions{display:flex;justify-content:flex-end;gap:.6rem;padding:1rem 0 .1rem;margin-top:1rem;border-top:1px solid rgba(255,255,255,.1)}.tc-entry-actions button{min-height:44px;min-width:110px}.tc-entry-danger{background:#dc2626!important;color:white!important}
        @media(max-width:560px){.tc-entry-backdrop{padding:.5rem}.tc-entry-dialog{max-height:calc(100dvh - 1rem);padding:1rem;border-radius:18px}.tc-entry-actions{position:sticky;bottom:-1rem;background:#0b0d12;padding-bottom:max(.7rem,env(safe-area-inset-bottom))}.tc-entry-actions button{flex:1}.tc-entry-grid{gap:.8rem .6rem}}
        @media(max-width:360px){.tc-entry-grid{grid-template-columns:minmax(0,1fr)}h2{font-size:1.2rem}}
      `}</style>
    </div>, document.body,
  );
}

