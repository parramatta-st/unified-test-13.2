import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { useEffect, useRef, useState } from 'react';
import { DOOR_CHOICE_KEY, DOOR_TOKEN_KEY, doorDuration, doorTime, newDoorRequestId, pendingKey, readDoorChoice, readDoorPending, type DoorPending } from '../../lib/doorClockClient';
import styles from '../../styles/doorClock.module.css';

type Tutor = { id: string; name: string };
type DoorState = { campus: string; campusName: string; linkId: string; tutors: Tutor[]; selectedId: string; activeShift: { shiftId: string; clockIn: string; version: number; needsReview: boolean } | null; serverTime: string };
type Receipt = { action: 'clock_in' | 'clock_out'; tutorName: string; timestamp: string };
function firstName(value: string) { return value.trim().split(/\s+/)[0] || 'there'; }
function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase(); }
function Icon({ kind }: { kind: 'tap' | 'clock' | 'arrow' | 'check' }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'clock' ? <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></> : kind === 'check' ? <path d="m5 12 4 4L19 6" /> : kind === 'arrow' ? <path d="M5 12h14m-5-5 5 5-5 5" /> : <><path d="M13 4a9 9 0 0 1 0 16M11 7a6 6 0 0 1 0 10M9 10a2.5 2.5 0 0 1 0 4" /><circle cx="5" cy="12" r="1" /></>}
  </svg>;
}
export default function DoorClockPage() {
  const [state, setState] = useState<DoorState | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [entryError, setEntryError] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<DoorPending | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [now, setNow] = useState(0);
  const [countdown, setCountdown] = useState(4);
  const tokenRef = useRef('');
  const stateRef = useRef<DoorState | null>(null);
  const selectedRef = useRef('');
  const sequence = useRef(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const pendingRef = useRef<DoorPending | null>(null);
  const receiptRef = useRef(false);
  const serverOffset = useRef(0);

  async function request(tutorId = '', body?: DoorPending) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(`/api/door-clock${body ? '' : `?tutorId=${encodeURIComponent(tutorId)}`}`, {
        method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { 'x-st-door-key': tokenRef.current, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const problem = new Error(data.error || 'This action could not be confirmed.');
        Object.assign(problem, { status: response.status, code: data.code }); throw problem;
      }
      return data;
    } finally { window.clearTimeout(timeout); }
  }
  function remember(campus: string, tutorId: string) {
    try { localStorage.setItem(DOOR_CHOICE_KEY, JSON.stringify({ campus, tutorId })); } catch { /* Private browsing still works. */ }
  }
  async function load(id = selectedRef.current, bootstrap = false) {
    if (busyRef.current || receiptRef.current) return;
    const generation = ++sequence.current;
    setLoading(true); setError('');
    try {
      const next = await request(id) as DoorState;
      if (!mounted.current || generation !== sequence.current) return;
      stateRef.current = next; setState(next);
      serverOffset.current = Date.parse(next.serverTime) - Date.now(); setNow(Date.now() + serverOffset.current);
      selectedRef.current = next.selectedId; setSelectedId(next.selectedId);
      if (next.selectedId) remember(next.campus, next.selectedId);
      if (bootstrap) {
        let old: DoorPending | null = null;
        try { old = readDoorPending(sessionStorage, pendingKey(next.campus, next.linkId)); } catch {}
        if (old && next.tutors.some(t => t.id === old!.tutorId)) {
          pendingRef.current = old; setPending(old); selectedRef.current = old.tutorId; setSelectedId(old.tutorId);
          setError('A previous clock action has not been confirmed. Check it below before starting another action.');
        } else {
          pendingRef.current = null; setPending(null);
          try { sessionStorage.removeItem(pendingKey(next.campus, next.linkId)); } catch {}
        }
      }
      setEntryError(false);
    } catch (problem: any) {
      if (!mounted.current || generation !== sequence.current) return;
      setError(problem?.name === 'AbortError' ? 'The connection took too long. Please try again.' : problem.message || 'Unable to load Time Clock.');
      if (problem.status === 401) { setEntryError(true); tokenRef.current = ''; try { sessionStorage.removeItem(DOOR_TOKEN_KEY); } catch {} }
      // Keep the previous display, but never enable an action from a failed status read.
    } finally { if (mounted.current && generation === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const start = () => {
      if (busyRef.current) return;
      const supplied = new URLSearchParams(window.location.hash.slice(1)).get('key');
      if (receiptRef.current && !supplied) return;
      if (supplied) { receiptRef.current = false; setReceipt(null); }
      if (supplied) {
        tokenRef.current = supplied;
        try { sessionStorage.setItem(DOOR_TOKEN_KEY, supplied); } catch {}
        window.history.replaceState(null, '', window.location.pathname);
      } else if (!tokenRef.current) {
        try { tokenRef.current = sessionStorage.getItem(DOOR_TOKEN_KEY) || ''; } catch {}
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(tokenRef.current)) {
        setEntryError(true); setError('Tap the centre NFC tag or scan its QR code to begin.'); setLoading(false); return;
      }
      let remembered = null;
      try { remembered = readDoorChoice(localStorage); } catch {}
      void load(remembered?.tutorId || '', true);
    };
    start();
    const focus = () => { if (!document.hidden && stateRef.current && !pendingRef.current && tokenRef.current) void load(); };
    window.addEventListener('hashchange', start);
    window.addEventListener('pageshow', focus);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    const tick = window.setInterval(() => setNow(Date.now() + serverOffset.current), 1000);
    return () => { mounted.current = false; sequence.current += 1; window.clearInterval(tick); window.removeEventListener('hashchange', start); window.removeEventListener('pageshow', focus); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, []);
  useEffect(() => {
    if (receipt?.action !== 'clock_in') return;
    setCountdown(4);
    const timer = window.setInterval(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    const redirect = window.setTimeout(() => window.location.replace('/login'), 4000);
    return () => { window.clearInterval(timer); window.clearTimeout(redirect); };
  }, [receipt]);

  function clearPending() {
    pendingRef.current = null; setPending(null);
    const current = stateRef.current;
    if (current) try { sessionStorage.removeItem(pendingKey(current.campus, current.linkId)); } catch {}
  }
  async function submit() {
    const current = stateRef.current;
    if (!current || busyRef.current || loading || receiptRef.current || !selectedRef.current) return;
    const chosen = current.tutors.find(t => t.id === selectedRef.current);
    if (!chosen) return;
    let operation = pendingRef.current;
    if (!operation) {
      if (error) return;
      operation = { requestId: newDoorRequestId(), tutorId: chosen.id,
        action: current.activeShift ? 'clock_out' : 'clock_in', expectedShiftId: current.activeShift?.shiftId || '', expectedVersion: current.activeShift?.version || 0, createdAt: Date.now() };
      pendingRef.current = operation; setPending(operation);
      try { sessionStorage.setItem(pendingKey(current.campus, current.linkId), JSON.stringify(operation)); } catch {}
    }
    busyRef.current = true; sequence.current += 1; setBusy(true); setError('');
    try {
      const result = await request('', operation);
      if (!mounted.current) return;
      remember(current.campus, chosen.id);
      clearPending(); receiptRef.current = true;
      setReceipt({ action: result.action, tutorName: result.tutorName, timestamp: result.timestamp });
    } catch (problem: any) {
      if (!mounted.current) return;
      // A 4xx rejection is definite. A timeout/5xx may have committed: retain the exact request ID.
      if (problem.status >= 400 && problem.status < 500 && problem.status !== 429) clearPending();
      setError(problem?.name === 'AbortError' ? 'Not confirmed yet. Check the result below; this will not create a duplicate shift.' : problem.message || 'Not confirmed yet. Please check the result below.');
      if (problem.status === 401) setEntryError(true);
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function changeTutor() {
    if (busyRef.current || pendingRef.current) return;
    sequence.current += 1; selectedRef.current = ''; setSelectedId(''); setLoading(false); setError(''); setQuery('');
    const current = stateRef.current;
    if (current) { const next = { ...current, selectedId: '', activeShift: null }; stateRef.current = next; setState(next); }
    try { localStorage.removeItem(DOOR_CHOICE_KEY); } catch {}
  }
  function choose(tutor: Tutor) {
    if (busyRef.current) return;
    selectedRef.current = tutor.id; setSelectedId(tutor.id);
    if (stateRef.current) remember(stateRef.current.campus, tutor.id);
    void load(tutor.id);
  }
  const chosen = state?.tutors.find(t => t.id === selectedId);
  const active = state?.selectedId === selectedId ? state.activeShift : null;
  const list = state?.tutors.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase())) || [];
  const actionName = pending ? (pending.action === 'clock_in' ? 'Check clock-in result' : 'Check clock-out result') : active ? 'Clock Out' : 'Clock In';
  return <div className={styles.page}>
    <Head><title>Door Time Clock | Success Tutoring</title><meta name="robots" content="noindex,nofollow,noarchive" /><meta name="referrer" content="no-referrer" /><meta name="theme-color" content="#0b1120" /></Head>
    <header className={styles.brand}><span className={styles.mark}>ST</span><span><strong>Success <span>Tutoring</span></strong><small>{state?.campusName || 'Centre Time Clock'}</small></span></header>
    <main className={styles.main}>
      <div className={styles.eyebrow}><Icon kind="tap" /> DOOR TIME CLOCK</div>
      <section className={styles.card} aria-busy={loading || busy}>
        {receipt ? <div className={styles.success} role="status" aria-live="polite">
          <span className={styles.successIcon}><Icon kind="check" /></span>
          <div className={styles.statusLabel}>ALL DONE, {firstName(receipt.tutorName).toUpperCase()}</div>
          <h1>{receipt.action === 'clock_in' ? "You're clocked in." : "You're clocked out."}</h1>
          <p className={styles.receiptTime}>{doorTime(receipt.timestamp)}</p>
          <p>{receipt.action === 'clock_in' ? 'Have a great shift!' : 'Thanks for today. See you next time!'}</p>
          <div className={styles.divider} />
          {receipt.action === 'clock_in' && <p className={styles.muted}>Opening the portal login in {countdown}...</p>}
          <a className={styles.primary} href="/login">Continue to portal login <Icon kind="arrow" /></a>
        </div> : entryError ? <div className={styles.empty}><span className={styles.heroIcon}><Icon kind="tap" /></span><h1>Start at the door.</h1><p role="alert">{error}</p><a className={styles.secondary} href="/login">Go to portal login</a></div> : !state ? <div className={styles.empty}><span className={styles.heroIcon}><Icon kind="clock" /></span><h1>{loading ? 'Getting ready...' : 'Let\u2019s try again.'}</h1><p role="status">{loading ? 'Connecting to your centre.' : error}</p>{!loading && <button className={styles.primary} onClick={() => load('', true)}>Try again</button>}</div> : chosen ? <>
          <div className={styles.greeting}><span className={styles.avatar}>{initials(chosen.name)}</span><div><h1>Hi {firstName(chosen.name)}.</h1><p>{chosen.name}</p></div></div>
          <div className={`${styles.clockPanel} ${active ? styles.onShift : ''}`}>
            <div className={styles.statusLabel}><span className={active ? styles.greenDot : styles.dot} />{loading ? 'CHECKING YOUR SHIFT' : pending ? 'CONFIRM YOUR LAST ACTION' : active ? 'CURRENTLY CLOCKED IN' : 'READY FOR YOUR SHIFT'}</div>
            <div className={styles.largeTime}>{now ? doorTime(new Date(now).toISOString()) : '--:--'}</div>
            <div className={styles.muted}>Sydney time</div>
            <div className={styles.shiftInfo}>{loading ? 'Checking the latest saved record...' : pending ? 'Your previous request is safe to retry.' : active ? <>Started {doorTime(active.clockIn, true)} <span>&middot; {doorDuration(active.clockIn, now)}</span></> : "You\u2019re not currently clocked in."}</div>
          </div>
          {active?.needsReview && !pending && <div className={styles.notice}>This shift needs review. Clock out when you finish, then ask your manager to check the times.</div>}
          {error && <div className={styles.error} role="alert">{error}</div>}
          <button className={`${styles.primary} ${active && !pending ? styles.outButton : ''}`} onClick={submit} disabled={busy || loading || (!!error && !pending)}><Icon kind={busy ? 'clock' : 'arrow'} />{busy ? 'Saving your shift...' : loading ? 'Checking your shift...' : actionName}</button>
          {error && !pending && <button className={styles.secondary} onClick={() => load()} disabled={busy || loading}>Refresh shift</button>}
          <p className={styles.footnote}>No password. No location check.</p>
          <button className={styles.change} onClick={changeTutor} disabled={busy || !!pending}>Not {firstName(chosen.name)}? <strong>Change tutor</strong></button>
        </> : <>
          <h1>Who&apos;s here?</h1><p className={styles.intro}>Choose your name to clock in or out.<br />We&apos;ll remember it on this phone.</p>
          {state.tutors.length > 6 && <label className={styles.search}><span className={styles.srOnly}>Search tutors</span><input placeholder="Find your name" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" /></label>}
          <div className={styles.tutorList}>{list.map(tutor => <button key={tutor.id} className={styles.tutor} onClick={() => choose(tutor)}><span className={styles.smallAvatar}>{initials(tutor.name)}</span><span>{tutor.name}</span><Icon kind="arrow" /></button>)}</div>
          {!list.length && <p className={styles.notice}>{state.tutors.length ? 'No matching names. Try another search.' : 'No active tutors are available. Please contact your centre manager.'}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <p className={styles.footnote}>Just your name. No login or GPS needed.</p>
        </>}
      </section>
      <p className={styles.bottom}>A small tap. One less thing to remember.</p>
      {!receipt && <a className={styles.portalLink} href="/login">Portal login <span aria-hidden="true">&rarr;</span></a>}
    </main>
    <footer className={styles.footer}>Success Tutoring <span>&middot;</span> Made for your teaching day</footer>
  </div>;
}
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return { props: {} };
};
