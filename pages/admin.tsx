import Link from 'next/link';
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import useAuthGuard from '../hooks/useAuthGuard';

type Dashboard = {
  ok: boolean;
  error?: string;
  tutor?: string;
  sources?: Record<string, boolean>;
  today?: { feedbackSent:number; prints:number; studentsPrinted:number };
  recentFeedback?: any[];
  recentPrints?: any[];
  failedPrints?: any[];
};

function formatDate(value: string | number) {
  if (!value) return '';
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney'
  }).format(d);
}

function Empty({ children }: { children: string }) {
  return <div className="text-sm text-muted mt-2">{children}</div>;
}

export default function AdminPage() {
  useAuthGuard();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin-dashboard', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not load admin dashboard');
      setData(json);
    } catch (e: any) {
      setData(null);
      setError(e?.message || 'Could not load admin dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <Header />
      <main className="container">
        <div className="card">
          <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 className="section-title">Admin Dashboard</h2>
              <p className="text-muted">Today’s activity, recent prints, recent feedback, and failed print jobs.</p>
            </div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              <Link className="btn" href="/admin/members" prefetch={false}>Members</Link>
              <Link className="btn" href="/admin/tutors" prefetch={false}>Tutors</Link>
              <Link className="btn" href="/settings" prefetch={false}>Print Colour Settings</Link>
              <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            </div>
          </div>

          {error && <div className="mt-4" style={{ color: '#fca5a5' }}>{error}</div>}

          {!error && (
            <>

              <section className="card mt-4">
                <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Today’s activity</h3>
                <div className="admin-stat-grid">
                  <div className="admin-stat-card"><strong>{data?.today?.feedbackSent ?? 0}</strong><span>Feedback sent today</span></div>
                  <div className="admin-stat-card"><strong>{data?.today?.prints ?? 0}</strong><span>Prints today</span></div>
                  <div className="admin-stat-card"><strong>{data?.today?.studentsPrinted ?? 0}</strong><span>Students printed for today</span></div>
                </div>
              </section>

              <section className="card mt-4">
                <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Recent prints</h3>
                {(data?.recentPrints || []).length ? data!.recentPrints!.map((e, idx) => (
                  <div className="admin-row" key={`${e.student}-${e.ms}-${idx}`}>
                    <div>
                      <strong>{e.student || 'Student'}</strong>
                      <div className="text-sm text-muted">{[e.year, e.subject, e.topic].filter(Boolean).join(' • ') || e.folder || e.kind}</div>
                      <div className="text-sm text-muted">{e.tutor || 'Unknown tutor'} · {formatDate(e.ms || e.timestamp)}</div>
                      {!!e.names?.length && <div className="text-sm text-muted">{e.names.slice(0, 6).join(', ')}{e.names.length > 6 ? '…' : ''}</div>}
                      {!!e.colorModes?.length && <div className="text-sm text-muted">Print mode: {Array.from(new Set(e.colorModes)).join(', ')}</div>}
                    </div>
                    <span>{e.okKnown === false ? '—' : e.ok ? 'OK' : 'Failed'}</span>
                  </div>
                )) : <Empty>No print rows loaded. Check the private Print Log sheet or legacy print-log fallback.</Empty>}
              </section>

              <section className="card mt-4">
                <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Recent feedback / progress</h3>
                {(data?.recentFeedback || []).length ? data!.recentFeedback!.map((e, idx) => (
                  <div className="admin-row" key={`${e.subjectLine}-${idx}`}>
                    <div>
                      <strong>{e.studentName || 'Student'}</strong>
                      <div className="text-sm text-muted">{[e.year, e.subject, e.topic || e.strand, e.lesson ? `Lesson ${e.lesson}` : ''].filter(Boolean).join(' • ')}</div>
                      <div className="text-sm text-muted">{e.tutorName || 'Unknown tutor'} · {formatDate(e.ms || e.timestamp)}</div>
                    </div>
                  </div>
                )) : <Empty>No feedback rows loaded. Check the private feedback log sheet or legacy feedback-log fallback.</Empty>}
              </section>

              <section className="card mt-4">
                <h3 className="section-title" style={{ fontSize: '1.2rem' }}>Failed print jobs</h3>
                {(data?.failedPrints || []).length ? data!.failedPrints!.map((e, idx) => (
                  <div className="admin-row" key={`${e.student}-${idx}`}>
                    <div>
                      <strong>{e.student || 'Unknown student'}</strong>
                      <div className="text-sm text-muted">{e.tutor || 'Unknown tutor'} · {formatDate(e.ms || e.timestamp)}</div>
                      <div className="text-sm text-muted">{[e.year, e.subject, e.topic].filter(Boolean).join(' • ') || e.folder || e.kind}</div>
                    </div>
                    <span>{e.kind || 'print'}</span>
                  </div>
                )) : <Empty>No failed print jobs found.</Empty>}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
