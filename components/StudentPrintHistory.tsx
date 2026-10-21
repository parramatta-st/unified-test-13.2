import { useEffect, useState } from 'react';
import type { StudentPrintBatch } from '../lib/studentPrintHistory';

export default function StudentPrintHistory({ student, studentId = '' }: { student: string; studentId?: string }) {
  const [prints, setPrints] = useState<StudentPrintBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true, inFlight = false, queued = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      // A large folder can finish files faster than Sheets answers. Coalesce
      // refreshes instead of repeatedly aborting the request already in flight.
      if (inFlight) { queued = true; return; }
      inFlight = true;
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), 20000);
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams({ studentName: student, studentId });
        const response = await fetch(`/api/student-print-history?${params}`, { signal: controller.signal, cache: 'no-store' });
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load print history.');
        if (live) { setPrints(json.prints || []); setWarning(json.warning || ''); setLoaded(true); }
      } catch {
        if (live) setError('Print history is unavailable.');
      } finally {
        clearTimeout(timer); inFlight = false;
        if (live) {
          setLoading(false);
          if (queued) { queued = false; void load(); }
        }
      }
    }
    // Keep the last successful result on screen during a background refresh.
    // The page keys this component by student, so another child never sees it.
    void load();
    const listener = () => { void load(); };
    window.addEventListener('st-print-history-changed', listener);
    window.addEventListener('focus', listener);
    return () => {
      live = false; clearTimeout(timer); controller?.abort();
      window.removeEventListener('st-print-history-changed', listener);
      window.removeEventListener('focus', listener);
    };
  }, [student, studentId, refresh]);
  return <section className="student-print-history" aria-label={`Print history for ${student}`}>
    <div className="print-history-heading"><strong>Last sent to printer</strong>{prints.length > 1 && <button type="button" className="btn" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? 'Hide history' : 'View history'}</button>}</div>
    {error && <p role="status">{error} <button type="button" className="btn" onClick={() => setRefresh(value => value + 1)}>Retry history</button></p>}
    {!loaded && loading ? <p>Loading print history…</p> : loaded && <>
      {warning && <p role="status">{warning}</p>}
      {!prints.length && !warning && <p>No previous printing recorded.</p>}
      {(expanded ? prints : prints.slice(0, 1)).map((print, i) => <div className="print-history-entry" key={print.batchId || i}>
        <strong>{[print.year, print.subject, print.topic].filter(Boolean).join(' · ') || print.folder || 'Worksheets'}</strong>
        <p>{print.names.slice(0, 3).join(', ') || 'Recorded worksheet submission'}</p>
        {print.names.length > 3 && <details><summary>Show all {print.names.length} files</summary><ul>{print.names.map((name,index) => <li key={index}>{name}</li>)}</ul></details>}
        <small>{print.ms ? new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(print.ms)) : print.timestamp} · {print.tutor || 'Tutor'} · {print.qty || 1} cop{(print.qty || 1) === 1 ? 'y' : 'ies'} · {print.source === 'automatic' ? 'Automatic Print' : 'Manual Print'}</small>
        {!!print.expected && <p className="print-history-progress">{print.sent} of {print.expected} files confirmed sent in this batch.</p>}
      </div>)}
    </>}
  </section>;
}
