import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import Header from '../../components/Header';
import { doorQrSvg } from '../../lib/doorQr';

type Status = { campus: string; enabled: boolean; updatedAt: string; updatedBy: string };
export default function DoorClockSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [qr, setQr] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    setError('');
    try {
      const response = await fetch('/api/admin-door-clock', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not load door settings.');
      setStatus(result);
    } catch (problem: any) { setError(problem.message || 'Could not load door settings.'); }
  }
  useEffect(() => { void load(); }, []);
  async function change(action: 'create' | 'rotate' | 'disable') {
    if (busyRef.current) return;
    if (action !== 'create' && !window.confirm(action === 'disable' ? 'Disable the current door NFC / QR link? Normal portal clocking will still work.' : 'Replace the door link? The existing NFC tag and QR code will stop working and must be updated.')) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin-door-clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not update the door link.');
      const nextUrl = result.path ? window.location.origin + result.path : '';
      setUrl(nextUrl); setQr(nextUrl ? doorQrSvg(nextUrl) : '');
      setNotice(nextUrl ? 'Door link created. Save it now, then write the full link to your NFC tag.' : 'Door link disabled. The usual portal Time Clock is unchanged.');
      await load();
    } catch (problem: any) {
      setError((problem.message || 'Could not update the door link.') + ' Do not automatically repeat this request; refresh the settings first.');
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setNotice('Full door link copied, including the access key.'); }
    catch { setNotice('Clipboard access is unavailable. Select and copy the full link in the field below.'); }
  }
  function saveQr() {
    const blob = new Blob([qr], { type: 'image/svg+xml' });
    const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = 'Success-Tutoring-Door-Clock-QR.svg'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  return <div><Head><title>Door NFC / QR | Success Tutoring</title><meta name="referrer" content="no-referrer" /></Head><Header />
    <main className="container"><section className="card door-settings">
      <div className="heading"><div><div className="eyebrow">TIME CLOCK</div><h1>Door NFC / QR</h1><p className="text-muted">A simple tap at the door. No portal login, PIN or GPS prompt.</p></div><Link className="btn" href="/admin">Back to Admin</Link></div>
      {error && <p className="admin-alert error" role="alert">{error}</p>}
      {notice && <p className="admin-alert success" role="status">{notice}</p>}
      {!status && !error && <p>Checking admin access and door settings...</p>}
      {status && <>
        <div className="setup-status"><span className={`badge ${status.enabled ? 'enabled' : ''}`}>{status.enabled ? 'Door link enabled' : 'Not enabled'}</span><span>{status.campus}</span>{status.updatedBy && <small>Last changed by {status.updatedBy}</small>}</div>
        <div className="explanation"><h2>How tutors will use it</h2><p>Tap the NFC tag or scan the QR code, choose a name once, then press Clock In or Clock Out. This phone remembers their choice, with a Change tutor option. After a confirmed clock-in, the page opens the portal login.</p><p>The link only permits attendance actions. It never signs a tutor into Feedback, Members, Inbox or Payroll. Door entries are labelled separately in the payroll audit.</p></div>
        <div className="actions"><button className="btn-primary" disabled={busy} onClick={() => change(status.enabled ? 'rotate' : 'create')}>{busy ? 'Updating...' : status.enabled ? 'Replace door link' : 'Create door link'}</button>{status.enabled && <button className="btn" disabled={busy} onClick={() => change('disable')}>Disable link</button>}<button className="btn" disabled={busy} onClick={load}>Refresh settings</button></div>
        {url ? <div className="new-link"><div><h2>Your NFC link</h2><p>Write this entire URL to an NFC tag as a website link. Keep the part after <code>#key=</code>.</p><label htmlFor="door-url">Door link (shown only when created)</label><textarea id="door-url" readOnly value={url} onFocus={event => event.target.select()} rows={4} spellCheck={false} /><div className="actions"><button className="btn-primary" onClick={copy}>Copy NFC link</button><a className="btn" href={url} target="_blank" rel="noreferrer">Open door page</a></div><p className="text-muted">Keep a private copy before leaving this page. The server stores only a hash, so a lost link must be replaced.</p></div><div className="qr-panel"><h2>QR fallback</h2><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`} alt="Scan to open the door Time Clock" width="240" height="240" /><button className="btn" onClick={saveQr}>Save QR image</button><p>Generated on this device. No external QR service receives the link.</p></div></div> : status.enabled && <p className="text-muted mt-4">The existing link is not revealed again. Use your saved copy, or replace it and rewrite the tag.</p>}
        <div className="explanation"><h2>Before putting it on the door</h2><p>Check one phone that has never used the portal. Test name selection, the remembered greeting, Clock In, the login redirect, and Clock Out. Reconcile that test shift in Payroll; void it if it was only a test.</p><p>Use a normal website-link NFC tag. The QR code opens the same page. A copied link can be used away from the centre; this is the trusted-tutor workflow, supported by the centre's fortnightly shift checks.</p></div>
      </>}
    </section></main>
    <style jsx>{`
      .door-settings { max-width: 1000px; margin: 0 auto; padding: clamp(22px,4vw,42px); }
      .heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
      h1 { margin: 8px 0 10px; font-size: clamp(27px,4vw,38px); letter-spacing: -.04em; } h2 { font-size: 18px; margin: 0 0 12px; }
      p { line-height: 1.7; font-size: 14px; } .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
      .setup-status { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 20px 0; border-block: 1px solid var(--border); margin: 22px 0; }
      .setup-status small { color: var(--muted); } .badge { padding: 7px 12px; border-radius: 99px; background: #292f3d; color: #d5e1ef; font-size: 12px; font-weight: 700; }.badge.enabled { background: #163d32; color: #a1efcb; }
      .explanation { margin-top: 26px; padding: 22px; border: 1px solid var(--border); border-radius: 16px; background: rgba(84,145,216,.04); }
      .new-link { display: grid; grid-template-columns: minmax(0,1fr) 265px; gap: 30px; border: 1px solid #466386; border-radius: 18px; padding: 24px; margin-top: 28px; background: #142136; }
      label { display: block; font-size: 12px; margin: 18px 0 8px; color: #c0d4ec; } textarea { width: 100%; padding: 12px; color: #e7f2ff; border: 1px solid #4e6787; border-radius: 12px; background: #0c1728; font-size: 14px; overflow-wrap: anywhere; resize: vertical; }
      .qr-panel { text-align: center; }.qr-panel img { width: min(100%,240px); height: auto; border-radius: 12px; display: block; margin: 15px auto; }.qr-panel p { color: #adc1da; font-size: 11px; }.qr-panel button { width: 100%; }
      @media(max-width: 700px) { .new-link { grid-template-columns: 1fr; padding: 18px; }.qr-panel { padding-top: 18px; border-top: 1px solid #3d526e; }.actions > * { min-height: 44px; flex: 1; }.explanation { padding: 17px; } }
    `}</style>
  </div>;
}
