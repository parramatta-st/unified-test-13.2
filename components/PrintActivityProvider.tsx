import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import PrintActivityPanel from './PrintActivityPanel';
import { useRouter } from 'next/router';
import { PrintActivityQueue, printRequest, type PrintBatch } from '../lib/printActivity';

type Submission = Pick<PrintBatch, 'label' | 'source' | 'items'>;
const PrintContext = createContext<{ enqueue: (input: Submission) => void; hasActive: boolean }>({ enqueue: () => { throw new Error('Printing is not ready.'); }, hasActive: false });
export const usePrintActivity = () => useContext(PrintContext);
type Recovery = { id: string; label: string; sent: number; total: number };

export default function PrintActivityProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [batches, setBatches] = useState<PrintBatch[]>([]);
  const [scope, setScope] = useState('');
  const [owner, setOwner] = useState<PrintActivityQueue | null>(null);
  const [recovery, setRecovery] = useState<Recovery[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [intro, setIntro] = useState('');
  const queue = useRef<PrintActivityQueue | null>(null);
  const storageKey = useRef('');
  const scopeRef = useRef('');
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastHistoryState = useRef('');
  const historyTimer = useRef<ReturnType<typeof setTimeout>>();
  const signedOut = router.pathname === '/login';

  useEffect(() => {
    let cancelled = false;
    if (signedOut) {
      queue.current?.stop(); queue.current = null; setOwner(null);
      setScope(''); scopeRef.current = ''; storageKey.current = '';
      setBatches([]); setRecovery([]); setIntro('');
      return;
    }
    void fetch('/api/admin-status', { cache: 'no-store' }).then(async response => {
      const auth = await response.json();
      if (cancelled || !response.ok || !auth.authed) return;
      const next = `${auth.campus}|${auth.tutor}`;
      if (scopeRef.current === next && queue.current) return;
      queue.current?.stop();
      scopeRef.current = next;
      storageKey.current = `st_print_activity_v1:${next}`;
      let restored: Recovery[] = [];
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey.current) || '[]');
        if (Array.isArray(saved)) restored = saved.filter(item => item && typeof item.label === 'string' && typeof item.id === 'string').slice(-20);
      } catch {}
      setRecovery(restored); setBatches([]); setScope(next);
      const instance = new PrintActivityQueue(printRequest, () => {
        if (queue.current !== instance) return;
        setBatches([...instance.batches]);
        // Refresh the visible student's history after sends/settlement without
        // tying the worker to a page's component lifetime.
        const state = instance.batches.map(batch => `${batch.id}:${batch.sent}:${batch.state === 'attention'}`).join('|');
        if (state !== lastHistoryState.current && instance.batches.some(batch => batch.sent > 0 || batch.state === 'attention')) {
          lastHistoryState.current = state;
          clearTimeout(historyTimer.current);
          historyTimer.current = setTimeout(() => window.dispatchEvent(new Event('st-print-history-changed')), 250);
        }
      });
      queue.current = instance; setOwner(instance);
    }).catch(() => { /* enqueue explains that the session is not ready */ });
    return () => { cancelled = true; };
  }, [signedOut]);

  useEffect(() => {
    if (!scope || !storageKey.current) return;
    const active = batches.filter(batch => ['queued', 'sending', 'attention'].includes(batch.state) && !batch.hidden)
      .map(batch => ({ id: batch.id, label: batch.label, sent: batch.sent, total: batch.items.length }));
    try { sessionStorage.setItem(storageKey.current, JSON.stringify([...recovery, ...active].slice(-20))); } catch {}
    for (const batch of batches) {
      if (batch.state === 'sent' && !batch.hidden && !timers.current.has(batch.id)) {
        const id = batch.id;
        timers.current.set(id, setTimeout(() => { queue.current?.hide(id); timers.current.delete(id); }, 5000));
      }
    }
  }, [batches, recovery, scope]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.current?.batches.some(batch => ['queued', 'sending'].includes(batch.state))) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    clearTimeout(historyTimer.current);
  }, []);

  const enqueue = useCallback((input: Submission) => {
    if (!owner || owner !== queue.current || !scopeRef.current) throw new Error('Your print session is loading. Try again in a moment, or sign in again.');
    const opening = !owner.batches.some(batch => !batch.hidden) && !recovery.length;
    owner.enqueue(input);
    if (opening) {
      setExpanded(!window.matchMedia('(max-width: 760px)').matches); setIntro(input.label);
    }
  }, [owner, recovery.length]);
  const docked = useCallback(() => setIntro(''), []);
  const visible = batches.filter(batch => !batch.hidden);
  const active = visible.filter(batch => ['queued', 'sending'].includes(batch.state)).length;
  const attention = recovery.length + visible.filter(batch => batch.state === 'attention').length;
  const title = active ? `Printing · ${active} job${active === 1 ? '' : 's'}` : attention ? `Print activity · ${attention} need attention` : 'Print activity';

  return <PrintContext.Provider value={{ enqueue, hasActive: active > 0 }}>
    {children}
    {!signedOut && (visible.length > 0 || recovery.length > 0) && <PrintActivityPanel intro={intro} expanded={expanded} onDocked={docked}>
      <button type="button" className="print-activity-heading" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><strong>{title}</strong><span aria-hidden="true">{expanded ? '⌄' : '⌃'}</span></button>
      {expanded && <div className="print-activity-list">
        {recovery.map(item => <article key={item.id} className="attention"><strong>{item.label}</strong><p>Previous page session interrupted. {item.sent} of {item.total} files were confirmed sent. Check the printer and history before reprinting. Nothing will resend automatically.</p><button type="button" className="btn" onClick={() => setRecovery(items => items.filter(other => other.id !== item.id))}>Dismiss notice</button></article>)}
        {visible.map(batch => <article key={batch.id} className={batch.state}>
          <strong>{batch.label}</strong>
          <div className="print-job-state" role="status">{batch.state === 'sent' ? '✓ Sent to printer' : batch.state === 'queued' ? 'Queued' : batch.state === 'attention' ? 'Needs attention' : batch.state === 'cancelled' ? 'Cancelled' : `Sending · ${Math.min(batch.sent + 1, batch.items.length)} of ${batch.items.length} files`}</div>
          {(batch.state === 'sending' || batch.state === 'sent') && <><progress value={batch.sent} max={batch.items.length} aria-label="Files sent" /><p className="print-current-file">{batch.state === 'sent' ? 'All files confirmed sent to printer.' : batch.current}</p></>}
          <p className="print-job-files">{batch.items.slice(0, 2).map(item => item.label).join(', ')}{batch.items.length > 2 ? ` + ${batch.items.length - 2} more` : ''}</p>
          <details><summary>{batch.items.length} file{batch.items.length === 1 ? '' : 's'} · {batch.source === 'manual' ? 'Manual Print' : 'Automatic Print'}</summary><ul>{batch.items.map((item, i) => <li key={i}>{item.student} · {item.label} · {item.payload.qty || 1} cop{item.payload.qty === 1 ? 'y' : 'ies'}</li>)}</ul></details>
          {batch.error && <p className="print-job-error">{batch.sent} of {batch.items.length} files confirmed sent. {batch.error}</p>}
          {batch.state === 'queued' && <button type="button" className="btn" onClick={() => queue.current?.cancel(batch.id)}>Cancel waiting job</button>}
          {batch.state === 'attention' && <button type="button" className="btn" onClick={() => queue.current?.hide(batch.id)}>Dismiss notice</button>}
        </article>)}
      </div>}
    </PrintActivityPanel>}
  </PrintContext.Provider>;
}
