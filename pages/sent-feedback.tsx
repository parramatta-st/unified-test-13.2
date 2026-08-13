import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import useAuthGuard from '../hooks/useAuthGuard';

type SentFeedbackItem = {
  id: string;
  timestamp: string;
  campusKey: string;
  campusName: string;
  tutorName: string;
  studentId: string;
  studentName: string;
  studentYear: string;
  parentName: string;
  parentEmail: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  subjectLine: string;
  messageText: string;
  sendStatus: 'sent' | 'failed' | string;
  messageId: string;
  feedbackType: string;
  mode: string;
  programLabel: string;
  lessonNumber: string;
  assessmentName: string;
  completionStatus: string;
  year: string;
  subject: string;
  strand: string;
  lesson: string;
  topic: string;
  sourceForm: string;
};

type SentFeedbackResponse = {
  ok: boolean;
  error?: string;
  items?: SentFeedbackItem[];
  total?: number;
  campus?: string;
  source?: string;
  warning?: string;
};

function norm(value: any) { return String(value ?? '').trim(); }

function formatSentAt(value: string) {
  const parsed = Date.parse(norm(value));
  if (Number.isNaN(parsed)) return value || 'Unknown time';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Sydney',
  }).format(new Date(parsed));
}

function shortSentAt(value: string) {
  const parsed = Date.parse(norm(value));
  if (Number.isNaN(parsed)) return value || '';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Sydney',
  }).format(new Date(parsed));
}

function subjectSummary(item: SentFeedbackItem) {
  return item.subjectLine || [item.subject, item.topic || item.strand, item.lesson].filter(Boolean).join(' • ') || 'Parent feedback';
}

function activitySummary(item: SentFeedbackItem) {
  const lesson = item.lesson || (item.lessonNumber ? `Lesson ${item.lessonNumber}` : '');
  return [item.year || item.studentYear, item.subject, item.topic || item.strand, lesson || item.assessmentName].filter(Boolean).join(' • ');
}

function senderLabel(item: SentFeedbackItem) {
  if (item.fromName && item.fromAddress) return `${item.fromName} <${item.fromAddress}>`;
  return item.fromAddress || item.fromName || item.campusName || 'Success Tutoring';
}

export default function SentFeedbackPage() {
  useAuthGuard();

  const [items, setItems] = useState<SentFeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'sent' | 'failed'>('all');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetch(`/api/sent-feedback?limit=300&_cb=${Date.now()}-${refreshKey}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const json = await response.json().catch(() => ({})) as SentFeedbackResponse;
        if (!response.ok || !json.ok) throw new Error(json.error || 'Failed to load sent feedback.');
        const nextItems = Array.isArray(json.items) ? json.items : [];
        setItems(nextItems);
        setTotal(Number(json.total || nextItems.length));
        setWarning(json.warning || '');
        setSelectedId((current) => current && nextItems.some((item) => item.id === current) ? current : (nextItems[0]?.id || ''));
      })
      .catch((fetchError: any) => {
        if (fetchError?.name !== 'AbortError') {
          setItems([]);
          setTotal(0);
          setError(fetchError?.message || 'Failed to load sent feedback.');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== 'all' && item.sendStatus !== status) return false;
      if (!needle) return true;
      const haystack = [
        item.studentName,
        item.studentYear,
        item.parentName,
        item.parentEmail,
        item.tutorName,
        item.subjectLine,
        item.messageText,
        item.subject,
        item.topic,
        item.strand,
        item.lesson,
        item.assessmentName,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, query, status]);

  const selected = useMemo(() => {
    return filtered.find((item) => item.id === selectedId) || filtered[0] || null;
  }, [filtered, selectedId]);

  const archivedBodyCount = useMemo(() => items.filter((item) => !!item.messageText).length, [items]);
  const failedCount = useMemo(() => items.filter((item) => item.sendStatus === 'failed').length, [items]);

  return (
    <div>
      <Header />
      <main className="container sent-page">
        <section className="card sent-hero">
          <div className="sent-hero-copy">
            <div className="eyebrow">Centre email archive</div>
            <h1 className="section-title sent-title">Sent Feedback</h1>
            <p className="text-muted sent-lead">
              Review feedback emails sent from this centre, including the recipient, sender alias, reply-to address and the exact message text stored at send time.
            </p>
          </div>
          <button type="button" className="btn" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh archive'}
          </button>
        </section>

        <section className="sent-stats mt-4">
          <div className="card sent-stat"><span>Logged emails</span><strong>{total}</strong></div>
          <div className="card sent-stat"><span>Full message archived</span><strong>{archivedBodyCount}</strong></div>
          <div className="card sent-stat"><span>Failed sends</span><strong>{failedCount}</strong></div>
        </section>

        <section className="card sent-controls mt-4">
          <div className="sent-search">
            <label className="label" htmlFor="sent-feedback-search">Search archive</label>
            <input
              id="sent-feedback-search"
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search student, parent, tutor, subject or feedback text…"
            />
          </div>
          <div>
            <label className="label">Status</label>
            <div className="segmented" role="group" aria-label="Filter sent feedback by status">
              <button type="button" className={`seg-btn${status === 'all' ? ' active' : ''}`} onClick={() => setStatus('all')}>All</button>
              <button type="button" className={`seg-btn${status === 'sent' ? ' active' : ''}`} onClick={() => setStatus('sent')}>Sent</button>
              <button type="button" className={`seg-btn${status === 'failed' ? ' active' : ''}`} onClick={() => setStatus('failed')}>Failed</button>
            </div>
          </div>
        </section>

        {warning && <div className="sent-warning mt-4">{warning}</div>}
        {error && <div className="sent-error mt-4">{error}</div>}

        {!error && (
          <section className="sent-workspace mt-4">
            <div className="card sent-list-panel">
              <div className="sent-panel-heading">
                <div>
                  <strong>{filtered.length} email{filtered.length === 1 ? '' : 's'}</strong>
                  <div className="text-sm text-muted">Newest first</div>
                </div>
              </div>

              {loading && !items.length ? (
                <div className="sent-empty">Loading sent feedback…</div>
              ) : filtered.length ? (
                <div className="sent-list">
                  {filtered.map((item) => {
                    const active = selected?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`sent-row${active ? ' active' : ''}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <div className="sent-row-top">
                          <strong>{item.studentName || 'Unknown student'}</strong>
                          <span className={`sent-status ${item.sendStatus === 'failed' ? 'failed' : 'sent'}`}>{item.sendStatus === 'failed' ? 'Failed' : 'Sent'}</span>
                        </div>
                        <div className="sent-row-subject">{subjectSummary(item)}</div>
                        <div className="sent-row-meta">
                          <span>{item.tutorName || 'Tutor not recorded'}</span>
                          <span>{shortSentAt(item.timestamp)}</span>
                        </div>
                        {item.messageText && <div className="sent-row-preview">{item.messageText.replace(/\s+/g, ' ').slice(0, 150)}</div>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="sent-empty">No feedback emails match this search.</div>
              )}
            </div>

            <div className="card sent-detail-panel">
              {selected ? (
                <>
                  <div className="sent-detail-head">
                    <div>
                      <div className="sent-detail-kicker">{selected.sendStatus === 'failed' ? 'Send failed' : 'Sent successfully'} • {formatSentAt(selected.timestamp)}</div>
                      <h2>{selected.studentName || 'Feedback email'}</h2>
                      {activitySummary(selected) && <div className="text-muted">{activitySummary(selected)}</div>}
                    </div>
                    <span className={`sent-status large ${selected.sendStatus === 'failed' ? 'failed' : 'sent'}`}>{selected.sendStatus === 'failed' ? 'Failed' : 'Sent'}</span>
                  </div>

                  <div className="sent-envelope mt-4">
                    <div><span>From</span><strong>{senderLabel(selected)}</strong></div>
                    <div><span>To</span><strong>{selected.parentName ? `${selected.parentName} <${selected.parentEmail}>` : selected.parentEmail || 'Not recorded'}</strong></div>
                    <div><span>Reply-To</span><strong>{selected.replyTo || 'Not recorded'}</strong></div>
                    <div><span>Tutor</span><strong>{selected.tutorName || 'Not recorded'}</strong></div>
                    <div className="wide"><span>Subject</span><strong>{subjectSummary(selected)}</strong></div>
                  </div>

                  <div className="sent-message mt-4">
                    <div className="sent-message-label">Email body</div>
                    {selected.messageText ? (
                      <pre>{selected.messageText}</pre>
                    ) : (
                      <div className="sent-legacy-note">
                        Full message text was not stored for this older feedback record. New emails sent after the Sent Feedback upgrade will appear here in full.
                      </div>
                    )}
                  </div>

                  <div className="sent-detail-footer mt-4">
                    <div><span>Parent email</span><strong>{selected.parentEmail || '—'}</strong></div>
                    <div><span>Message ID</span><strong className="sent-message-id">{selected.messageId || 'Legacy record'}</strong></div>
                    {selected.completionStatus && <div><span>Completion</span><strong>{selected.completionStatus}</strong></div>}
                  </div>
                </>
              ) : (
                <div className="sent-empty detail">Select an email to view its full details.</div>
              )}
            </div>
          </section>
        )}

        <p className="text-sm text-muted sent-footnote mt-4">
          Archive access is scoped to the logged-in centre. Older records can still appear, but their full email body is only available if it was stored at the time of sending.
        </p>
      </main>

      <style jsx>{`
        .sent-page { max-width: 1280px; }
        .sent-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1.5rem;
          background:
            radial-gradient(circle at 90% 15%, rgba(46,186,223,.10), transparent 28%),
            radial-gradient(circle at 10% 0%, rgba(249,115,22,.12), transparent 30%),
            var(--panel);
        }
        .sent-hero-copy { max-width: 760px; }
        .sent-title { margin-bottom: .45rem; }
        .sent-lead { margin: 0; line-height: 1.55; }
        .sent-stats { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 1rem; }
        .sent-stat { display: flex; flex-direction: column; gap: .25rem; }
        .sent-stat span { color: var(--muted); font-size: .85rem; }
        .sent-stat strong { font-size: 1.7rem; }
        .sent-controls { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 1rem; align-items: end; }
        .sent-search { min-width: 0; }
        .sent-warning, .sent-error {
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: .85rem 1rem;
        }
        .sent-warning { color: #fde68a; background: rgba(120,53,15,.24); border-color: rgba(245,158,11,.3); }
        .sent-error { color: #fecaca; background: rgba(127,29,29,.3); border-color: rgba(248,113,113,.35); }
        .sent-workspace { display: grid; grid-template-columns: minmax(320px,.9fr) minmax(0,1.6fr); gap: 1rem; align-items: start; }
        .sent-list-panel, .sent-detail-panel { padding: 0; overflow: hidden; }
        .sent-panel-heading { padding: 1rem 1rem .8rem; border-bottom: 1px solid var(--border); }
        .sent-list { max-height: 720px; overflow-y: auto; }
        .sent-row {
          width: 100%;
          display: block;
          text-align: left;
          border: 0;
          border-bottom: 1px solid var(--border);
          background: transparent;
          color: var(--text);
          padding: .95rem 1rem;
          cursor: pointer;
        }
        .sent-row:hover { background: rgba(255,255,255,.035); }
        .sent-row.active { background: rgba(249,115,22,.09); box-shadow: inset 3px 0 0 var(--accent); }
        .sent-row-top { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
        .sent-row-subject { margin-top: .25rem; color: var(--text-dim); font-size: .92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sent-row-meta { margin-top: .35rem; color: var(--muted); font-size: .8rem; display: flex; justify-content: space-between; gap: .75rem; }
        .sent-row-preview { margin-top: .45rem; color: var(--muted); font-size: .82rem; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .sent-status {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: .2rem .5rem;
          font-size: .72rem;
          font-weight: 800;
          letter-spacing: .02em;
          border: 1px solid transparent;
          flex: 0 0 auto;
        }
        .sent-status.sent { color: #bbf7d0; background: rgba(22,101,52,.28); border-color: rgba(34,197,94,.3); }
        .sent-status.failed { color: #fecaca; background: rgba(127,29,29,.35); border-color: rgba(248,113,113,.32); }
        .sent-status.large { padding: .35rem .7rem; font-size: .78rem; }
        .sent-detail-panel { padding: 1.15rem; min-height: 420px; }
        .sent-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
        .sent-detail-head h2 { margin: .2rem 0 .25rem; font-size: 1.55rem; }
        .sent-detail-kicker { color: var(--muted); font-size: .82rem; }
        .sent-envelope {
          display: grid;
          grid-template-columns: repeat(2,minmax(0,1fr));
          gap: .7rem;
          padding: .9rem;
          background: rgba(255,255,255,.025);
          border: 1px solid var(--border);
          border-radius: 14px;
        }
        .sent-envelope > div { min-width: 0; display: flex; flex-direction: column; gap: .2rem; }
        .sent-envelope .wide { grid-column: 1 / -1; }
        .sent-envelope span, .sent-detail-footer span { color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .05em; }
        .sent-envelope strong { font-size: .9rem; overflow-wrap: anywhere; }
        .sent-message { border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
        .sent-message-label { padding: .65rem .9rem; font-size: .78rem; font-weight: 800; color: var(--muted); background: #101010; border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: .06em; }
        .sent-message pre {
          margin: 0;
          padding: 1.1rem;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font: inherit;
          line-height: 1.6;
          color: var(--text);
          background: rgba(0,0,0,.16);
        }
        .sent-legacy-note { padding: 1rem; color: var(--muted); line-height: 1.5; }
        .sent-detail-footer { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .8rem; }
        .sent-detail-footer > div { display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
        .sent-detail-footer strong { overflow-wrap: anywhere; font-size: .88rem; }
        .sent-message-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem !important; }
        .sent-empty { padding: 2rem 1rem; color: var(--muted); text-align: center; }
        .sent-empty.detail { min-height: 340px; display: grid; place-items: center; }
        .sent-footnote { text-align: center; }
        @media (max-width: 900px) {
          .sent-hero { flex-direction: column; }
          .sent-stats { grid-template-columns: 1fr; }
          .sent-controls { grid-template-columns: 1fr; }
          .sent-workspace { grid-template-columns: 1fr; }
          .sent-list { max-height: 420px; }
          .sent-envelope, .sent-detail-footer { grid-template-columns: 1fr; }
          .sent-envelope .wide { grid-column: auto; }
        }
      `}</style>
    </div>
  );
}