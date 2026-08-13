import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '../components/Header';
import useAuthGuard from '../hooks/useAuthGuard';

type InboxMessage = {
  timestamp: string;
  eventType: string;
  direction: string;
  actorRole: string;
  actorName: string;
  fromAddress: string;
  toAddress: string;
  subjectLine: string;
  messageText: string;
  gmailMessageId: string;
  gmailThreadId: string;
  sourceMessageId: string;
  sendStatus: string;
  attachmentNames: string[];
};

type InboxConversation = {
  id: string;
  timestamp: string;
  conversationId: string;
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
  centreInbox: string;
  relayEnabled: boolean;
  relayToken: string;
  subjectLine: string;
  messageText: string;
  sendStatus: string;
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
  replies: InboxMessage[];
  replyCount: number;
  latestReplyAt: string;
  latestActivityAt: string;
  latestMessagePreview: string;
  latestMessageRole: string;
  latestGmailThreadId: string;
  latestInboundAt: string;
  latestOutboundAt: string;
  lastReadAt: string;
  unreadCount: number;
  isUnread: boolean;
  canReply: boolean;
};

type InboxResponse = {
  ok: boolean;
  error?: string;
  items?: InboxConversation[];
  total?: number;
  unreadTotal?: number;
  campus?: string;
  tutor?: string;
  warning?: string;
};

type Folder = 'inbox' | 'unread' | 'replied' | 'failed' | 'all';

function norm(value: any) { return String(value ?? '').trim(); }
function lower(value: any) { return norm(value).toLowerCase(); }

function formatDate(value: string, compact = false) {
  const parsed = Date.parse(norm(value));
  if (Number.isNaN(parsed)) return value || '';
  const date = new Date(parsed);
  const today = new Date();
  const sameDay = date.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' }) === today.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' });
  if (compact && sameDay) {
    return new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }).format(date);
  }
  if (compact) {
    return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Sydney' }).format(date);
  }
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney',
  }).format(date);
}

function initials(value: string) {
  const parts = norm(value).split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ST';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function repliesFor(item?: InboxConversation | null) {
  return Array.isArray(item?.replies) ? item!.replies : [];
}

function latestMessage(item: InboxConversation) {
  const replies = repliesFor(item);
  return replies.length ? replies[replies.length - 1] : null;
}

function isParentMessage(message: InboxMessage) {
  return lower(message.eventType) === 'parent_reply' || lower(message.actorRole) === 'parent';
}

function cleanDisplayText(value: string) {
  let text = String(value || '').replace(/\r\n/g, '\n').trim();
  text = text.replace(/<https?:\/\/[^>\s]{180,}>/g, '');
  const quoted = text.search(/\nOn [^\n]+wrote:\s*/i);
  if (quoted > 0) text = text.slice(0, quoted).trim();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function campusSignatureName(campusName: string) {
  const clean = norm(campusName)
    .replace(/\bsuccess\s+tutoring\b/gi, ' ')
    .replace(/\bsuccess\b/gi, ' ')
    .replace(/\btutoring\b/gi, ' ')
    .replace(/\bcentre\b/gi, ' ')
    .replace(/\bcenter\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || norm(campusName) || 'Success Tutoring';
}

function defaultSignature(tutor: string, campusName: string) {
  const lines = [norm(tutor), `${campusSignatureName(campusName)}, Success Tutoring`].filter(Boolean);
  return lines.join('\n');
}

function threadSender(item: InboxConversation) {
  const message = latestMessage(item);
  if (!message) return item.fromName || item.campusName || 'Success Tutoring';
  if (isParentMessage(message)) return message.actorName || item.parentName || item.parentEmail || 'Parent';
  return message.actorName || item.fromName || item.campusName || 'Success Tutoring';
}

function threadSnippet(item: InboxConversation) {
  return cleanDisplayText(item.latestMessagePreview || item.messageText).replace(/\s+/g, ' ').slice(0, 180);
}

function folderLabel(folder: Folder) {
  if (folder === 'unread') return 'Unread';
  if (folder === 'replied') return 'Replied';
  if (folder === 'failed') return 'Failed';
  if (folder === 'all') return 'All feedback';
  return 'Inbox';
}

export default function SentFeedbackPage() {
  useAuthGuard();
  const router = useRouter();
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTutor, setAdminTutor] = useState('');
  const [items, setItems] = useState<InboxConversation[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [folder, setFolder] = useState<Folder>('inbox');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyActorName, setReplyActorName] = useState('');
  const [signature, setSignature] = useState('');
  const [includeSignature, setIncludeSignature] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendNotice, setSendNotice] = useState('');
  const [markingRead, setMarkingRead] = useState(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin-status', { cache: 'no-store' })
      .then((response) => response.json())
      .then((json) => {
        if (cancelled) return;
        const admin = !!json?.isAdmin;
        setIsAdmin(admin);
        setAdminTutor(norm(json?.tutor));
        setAdminChecked(true);
        if (!admin) router.replace('/feedback');
      })
      .catch(() => {
        if (!cancelled) {
          setAdminChecked(true);
          setIsAdmin(false);
          router.replace('/feedback');
        }
      });
    return () => { cancelled = true; };
  }, [router]);

  const loadInbox = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/sent-feedback?limit=1000&_cb=${Date.now()}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({})) as InboxResponse;
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not load the feedback inbox.');
      const next = Array.isArray(json.items) ? json.items : [];
      setItems(next);
      setTotal(Number(json.total || next.length));
      setUnreadTotal(Number(json.unreadTotal || 0));
      setWarning(json.warning || '');
      setAdminTutor((current) => current || norm(json.tutor));
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : '');
      window.dispatchEvent(new CustomEvent('st-inbox-refresh', { detail: { unreadTotal: Number(json.unreadTotal || 0) } }));
    } catch (loadError: any) {
      setError(loadError?.message || 'Could not load the feedback inbox.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!adminChecked || !isAdmin) return;
    loadInbox();
    const interval = window.setInterval(() => loadInbox(true), 30000);
    return () => window.clearInterval(interval);
  }, [adminChecked, isAdmin, loadInbox]);

  const filtered = useMemo(() => {
    const needle = lower(query);
    return items.filter((item) => {
      if (folder === 'inbox' && item.sendStatus === 'failed') return false;
      if (folder === 'unread' && !item.isUnread) return false;
      if (folder === 'replied' && !item.latestOutboundAt) return false;
      if (folder === 'failed' && item.sendStatus !== 'failed') return false;
      if (needle) {
        const messageText = repliesFor(item).flatMap((message) => [message.actorName, message.fromAddress, message.toAddress, message.messageText]);
        const haystack = [
          item.studentName, item.parentName, item.parentEmail, item.tutorName, item.subjectLine,
          item.messageText, item.year, item.subject, item.topic, item.strand, item.lesson, ...messageText,
        ].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [folder, items, query]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return filtered.find((item) => item.id === selectedId) || null;
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setReplyText('');
    setReplyOpen(false);
    setSendNotice('');
    let storedTutor = adminTutor;
    let storedCampus = selected.campusName;
    try {
      storedTutor = localStorage.getItem('st_tutor_full') || adminTutor;
      storedCampus = localStorage.getItem('st_campus') || selected.campusName;
      const key = selected.campusKey || 'centre';
      setReplyActorName(localStorage.getItem(`st_inbox_actor_${key}`) || storedTutor || selected.fromName || 'Centre admin');
      setSignature(localStorage.getItem(`st_inbox_signature_${key}`) || defaultSignature(storedTutor, storedCampus));
    } catch {
      setReplyActorName(storedTutor || selected.fromName || 'Centre admin');
      setSignature(defaultSignature(storedTutor, storedCampus));
    }
  }, [selected?.conversationId, adminTutor]);

  const markConversationRead = useCallback(async (conversation: InboxConversation) => {
    if (!conversation.isUnread || markingRead) return;
    setMarkingRead(true);
    setItems((current) => current.map((item) => item.conversationId === conversation.conversationId
      ? { ...item, isUnread: false, unreadCount: 0, lastReadAt: new Date().toISOString() }
      : item));
    setUnreadTotal((current) => Math.max(0, current - 1));
    window.dispatchEvent(new CustomEvent('st-inbox-refresh', { detail: { unreadTotal: Math.max(0, unreadTotal - 1) } }));
    try {
      const response = await fetch('/api/inbox-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conversation.conversationId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Could not mark the conversation as read.');
    } catch (readError: any) {
      setError(readError?.message || 'Could not mark the conversation as read.');
      loadInbox(true);
    } finally {
      setMarkingRead(false);
    }
  }, [loadInbox, markingRead, unreadTotal]);

  useEffect(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    if (!selected?.isUnread) return;
    readTimer.current = setTimeout(() => markConversationRead(selected), 650);
    return () => { if (readTimer.current) clearTimeout(readTimer.current); };
  }, [selected?.conversationId, selected?.isUnread, markConversationRead]);

  function selectConversation(item: InboxConversation) {
    setSelectedId(item.id);
  }

  function updateActorName(value: string) {
    setReplyActorName(value);
    try { localStorage.setItem(`st_inbox_actor_${selected?.campusKey || 'centre'}`, value); } catch {}
  }

  function updateSignature(value: string) {
    setSignature(value);
    try { localStorage.setItem(`st_inbox_signature_${selected?.campusKey || 'centre'}`, value); } catch {}
  }

  async function sendReply() {
    if (!selected || sending) return;
    if (!replyText.trim()) {
      setSendNotice('Write a reply before sending.');
      return;
    }
    setSending(true);
    setSendNotice('');
    const clientRequestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    try {
      const response = await fetch('/api/inbox-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selected.conversationId,
          messageText: replyText,
          signature,
          includeSignature,
          actorName: replyActorName,
          clientRequestId,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Reply could not be sent.');
      setReplyText('');
      setReplyOpen(false);
      setSendNotice(json.warning || 'Reply sent successfully.');
      setItems((current) => current.map((item) => item.conversationId === selected.conversationId
        ? { ...item, isUnread: false, unreadCount: 0 }
        : item));
      window.dispatchEvent(new Event('st-inbox-refresh'));
      await loadInbox(true);
    } catch (sendError: any) {
      setSendNotice(sendError?.message || 'Reply could not be sent.');
    } finally {
      setSending(false);
    }
  }

  const folderCounts = useMemo(() => ({
    inbox: items.filter((item) => item.sendStatus !== 'failed').length,
    unread: items.filter((item) => item.isUnread).length,
    replied: items.filter((item) => !!item.latestOutboundAt).length,
    failed: items.filter((item) => item.sendStatus === 'failed').length,
    all: items.length,
  }), [items]);

  if (!adminChecked || (adminChecked && !isAdmin)) {
    return (
      <div>
        <Header />
        <main className="container" style={{ paddingTop: '3rem' }}>
          <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>Checking admin access…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="inbox-page">
      <Header />
      <main className="mail-app">
        <aside className="mail-sidebar" aria-label="Mailbox folders">
          <div className="sidebar-title">Feedback mail</div>
          <button className={`folder-button${folder === 'inbox' ? ' active' : ''}`} onClick={() => setFolder('inbox')}>
            <span className="folder-icon">▰</span><span>Inbox</span>{unreadTotal > 0 && <strong className="folder-unread">{unreadTotal}</strong>}
          </button>
          <button className={`folder-button${folder === 'unread' ? ' active' : ''}`} onClick={() => setFolder('unread')}>
            <span className="folder-icon">●</span><span>Unread</span><span className="folder-count">{folderCounts.unread}</span>
          </button>
          <button className={`folder-button${folder === 'replied' ? ' active' : ''}`} onClick={() => setFolder('replied')}>
            <span className="folder-icon">↩</span><span>Replied</span><span className="folder-count">{folderCounts.replied}</span>
          </button>
          <button className={`folder-button${folder === 'failed' ? ' active' : ''}`} onClick={() => setFolder('failed')}>
            <span className="folder-icon">!</span><span>Failed</span><span className="folder-count">{folderCounts.failed}</span>
          </button>
          <button className={`folder-button${folder === 'all' ? ' active' : ''}`} onClick={() => setFolder('all')}>
            <span className="folder-icon">▤</span><span>All feedback</span><span className="folder-count">{folderCounts.all}</span>
          </button>
          <div className="sidebar-note">
            Admin-only inbox for portal feedback conversations. Read status is shared by the centre’s admins.
          </div>
        </aside>

        <section className="mail-main">
          <div className="mail-toolbar">
            <div className="toolbar-title">
              <h1>{folderLabel(folder)}</h1>
              <span>{filtered.length} conversation{filtered.length === 1 ? '' : 's'}</span>
            </div>
            <div className="mail-search-wrap">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search feedback mail" aria-label="Search feedback mail" />
            </div>
            <button className="icon-button" onClick={() => loadInbox()} disabled={loading} aria-label="Refresh inbox" title="Refresh inbox">
              {loading ? '…' : '↻'}
            </button>
          </div>

          {warning && <div className="mail-warning">{warning}</div>}
          {error && <div className="mail-error">{error}</div>}

          <div className="mail-split">
            <section className="thread-list" aria-label="Feedback conversations">
              {loading && !items.length ? (
                <div className="empty-state">Loading feedback mail…</div>
              ) : filtered.length ? filtered.map((item) => {
                const active = selected?.id === item.id;
                const sender = threadSender(item);
                const snippet = threadSnippet(item);
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`thread-row${active ? ' active' : ''}${item.isUnread ? ' unread' : ''}`}
                    onClick={() => selectConversation(item)}
                  >
                    <span className={`thread-avatar${item.isUnread ? ' unread' : ''}`}>{initials(sender)}</span>
                    <span className="thread-copy">
                      <span className="thread-topline">
                        <strong>{sender}</strong>
                        <time>{formatDate(item.latestActivityAt || item.timestamp, true)}</time>
                      </span>
                      <span className="thread-subject">
                        {item.subjectLine || 'Feedback email'}
                        {item.replyCount > 0 && <em>{item.replyCount + 1}</em>}
                      </span>
                      <span className="thread-snippet">{snippet || 'No message preview available.'}</span>
                      <span className="thread-meta">{item.studentName || 'Student'} · {item.tutorName || 'Tutor not recorded'}</span>
                    </span>
                    {item.isUnread && <span className="unread-pill" aria-label={`${item.unreadCount} unread reply`}>{item.unreadCount || 1}</span>}
                  </button>
                );
              }) : (
                <div className="empty-state">No conversations match this folder or search.</div>
              )}
            </section>

            <article className="thread-view">
              {selected ? (
                <>
                  <header className="thread-header">
                    <div>
                      <div className="thread-kicker">{selected.studentName || 'Feedback conversation'} · {selected.studentYear || selected.year || 'Year not recorded'}</div>
                      <h2>{selected.subjectLine || 'Feedback email'}</h2>
                      <div className="thread-participants">
                        {selected.parentName || 'Parent'} &lt;{selected.parentEmail || 'email not recorded'}&gt;
                      </div>
                    </div>
                    <div className="thread-actions">
                      {selected.isUnread && <button className="small-button" onClick={() => markConversationRead(selected)}>Mark read</button>}
                      <button className="primary-reply" onClick={() => setReplyOpen((current) => !current)} disabled={!selected.canReply}>↩ Reply</button>
                    </div>
                  </header>

                  <section className="message-stack">
                    <div className="mail-message centre-message">
                      <div className="message-avatar">{initials(selected.fromName || selected.campusName)}</div>
                      <div className="message-body">
                        <div className="message-head">
                          <div>
                            <strong>{selected.fromName || selected.campusName || 'Success Tutoring'}</strong>
                            <span>to {selected.parentEmail || 'parent'}</span>
                          </div>
                          <time>{formatDate(selected.timestamp)}</time>
                        </div>
                        <div className="message-subject">Original feedback</div>
                        <pre>{cleanDisplayText(selected.messageText) || 'Full message text was not stored for this older record.'}</pre>
                      </div>
                    </div>

                    {repliesFor(selected).map((message, index) => {
                      const parent = isParentMessage(message);
                      const senderName = parent
                        ? (message.actorName || selected.parentName || 'Parent')
                        : (message.actorName || selected.fromName || selected.campusName || 'Success Tutoring');
                      return (
                        <div className={`mail-message ${parent ? 'parent-message' : 'centre-message'}`} key={`${message.gmailMessageId || message.sourceMessageId || message.timestamp}-${index}`}>
                          <div className="message-avatar">{initials(senderName)}</div>
                          <div className="message-body">
                            <div className="message-head">
                              <div>
                                <strong>{senderName}</strong>
                                <span>to {message.toAddress || (parent ? selected.centreInbox : selected.parentEmail) || 'recipient'}</span>
                              </div>
                              <time>{formatDate(message.timestamp)}</time>
                            </div>
                            <div className="message-subject">{parent ? 'Parent reply' : lower(message.eventType) === 'portal_reply' ? 'Reply sent from portal' : 'Centre reply'}</div>
                            <pre>{cleanDisplayText(message.messageText) || 'No message text was stored.'}</pre>
                            {Array.isArray(message.attachmentNames) && message.attachmentNames.length > 0 && (
                              <div className="attachment-list">{message.attachmentNames.map((name) => <span key={name}>▣ {name}</span>)}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </section>

                  <section className={`reply-composer${replyOpen ? ' open' : ''}`}>
                    {!replyOpen ? (
                      <button className="reply-placeholder" onClick={() => setReplyOpen(true)} disabled={!selected.canReply}>
                        ↩ Reply to {selected.parentName || selected.parentEmail || 'parent'}
                      </button>
                    ) : (
                      <>
                        <div className="composer-heading">
                          <div><strong>Reply</strong><span>to {selected.parentEmail}</span></div>
                          <button className="composer-close" onClick={() => setReplyOpen(false)} aria-label="Close reply composer">×</button>
                        </div>
                        <textarea
                          className="reply-textarea"
                          value={replyText}
                          onChange={(event) => setReplyText(event.target.value)}
                          placeholder="Write your reply…"
                          autoFocus
                        />
                        <div className="signature-grid">
                          <label>
                            <span>Replying as</span>
                            <input value={replyActorName} onChange={(event) => updateActorName(event.target.value)} />
                          </label>
                          <label className="signature-field">
                            <span>Signature <small>(editable)</small></span>
                            <textarea value={signature} onChange={(event) => updateSignature(event.target.value)} rows={3} />
                          </label>
                        </div>
                        <label className="signature-toggle">
                          <input type="checkbox" checked={includeSignature} onChange={(event) => setIncludeSignature(event.target.checked)} />
                          Include signature in this reply
                        </label>
                        <div className="composer-footer">
                          <div className="from-hint">From {selected.fromName || selected.campusName} &lt;{selected.fromAddress}&gt;</div>
                          <button className="send-button" onClick={sendReply} disabled={sending || !replyText.trim()}>{sending ? 'Sending…' : 'Send'}</button>
                        </div>
                      </>
                    )}
                  </section>
                  {sendNotice && <div className={`send-notice${/success|sent/i.test(sendNotice) ? ' success' : ''}`}>{sendNotice}</div>}
                </>
              ) : (
                <div className="empty-state detail">Select a feedback conversation to read it.</div>
              )}
            </article>
          </div>
        </section>
      </main>

      <style jsx>{`
        .inbox-page { min-height: 100vh; background: #090b0f; }
        .mail-app { max-width: 1600px; margin: 0 auto; padding: 1rem; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 1rem; }
        .mail-sidebar { position: sticky; top: 1rem; align-self: start; padding: .65rem; border-radius: 18px; border: 1px solid var(--border); background: rgba(18,21,27,.96); min-height: calc(100vh - 7rem); }
        .sidebar-title { padding: .8rem .85rem 1rem; color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }
        .folder-button { width: 100%; border: 0; color: var(--text); background: transparent; border-radius: 999px; display: grid; grid-template-columns: 26px 1fr auto; align-items: center; gap: .45rem; padding: .72rem .85rem; text-align: left; cursor: pointer; font: inherit; }
        .folder-button:hover { background: rgba(255,255,255,.05); }
        .folder-button.active { background: rgba(249,115,22,.17); color: #fed7aa; font-weight: 800; }
        .folder-icon { width: 24px; text-align: center; color: var(--muted); }
        .folder-button.active .folder-icon { color: #fb923c; }
        .folder-count { color: var(--muted); font-size: .8rem; }
        .folder-unread { min-width: 24px; height: 24px; border-radius: 999px; display: grid; place-items: center; padding: 0 .4rem; color: white; background: #ea580c; font-size: .75rem; }
        .sidebar-note { margin: 1.25rem .65rem 0; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .76rem; line-height: 1.55; }
        .mail-main { min-width: 0; border: 1px solid var(--border); border-radius: 18px; background: rgba(14,17,22,.96); overflow: hidden; }
        .mail-toolbar { min-height: 72px; padding: .75rem 1rem; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: auto minmax(260px, 640px) 44px; align-items: center; gap: 1rem; }
        .toolbar-title h1 { margin: 0; font-size: 1.25rem; }
        .toolbar-title span { color: var(--muted); font-size: .78rem; }
        .mail-search-wrap { height: 44px; border-radius: 999px; background: rgba(255,255,255,.055); display: flex; align-items: center; gap: .6rem; padding: 0 1rem; border: 1px solid transparent; }
        .mail-search-wrap:focus-within { border-color: rgba(56,189,248,.45); background: rgba(255,255,255,.075); }
        .mail-search-wrap input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; }
        .icon-button { width: 42px; height: 42px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; font-size: 1.2rem; }
        .mail-warning, .mail-error { margin: .75rem 1rem 0; padding: .75rem 1rem; border-radius: 12px; font-size: .86rem; }
        .mail-warning { background: rgba(120,53,15,.24); color: #fde68a; }
        .mail-error { background: rgba(127,29,29,.3); color: #fecaca; }
        .mail-split { display: grid; grid-template-columns: minmax(380px, .95fr) minmax(520px, 1.55fr); min-height: calc(100vh - 10rem); }
        .thread-list { border-right: 1px solid var(--border); overflow-y: auto; max-height: calc(100vh - 10rem); background: rgba(7,9,13,.42); }
        .thread-row { width: 100%; display: grid; grid-template-columns: 42px minmax(0,1fr) auto; gap: .75rem; align-items: start; padding: .9rem 1rem; border: 0; border-bottom: 1px solid rgba(255,255,255,.06); background: transparent; color: var(--text); text-align: left; cursor: pointer; }
        .thread-row:hover { background: rgba(255,255,255,.04); }
        .thread-row.active { background: rgba(56,189,248,.08); box-shadow: inset 3px 0 0 #38bdf8; }
        .thread-row.unread { background: rgba(255,255,255,.065); }
        .thread-row.unread.active { background: rgba(56,189,248,.12); }
        .thread-avatar, .message-avatar { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: rgba(148,163,184,.18); color: #e2e8f0; font-size: .78rem; font-weight: 800; }
        .thread-avatar.unread { background: #2563eb; color: white; }
        .thread-copy { min-width: 0; display: flex; flex-direction: column; gap: .15rem; }
        .thread-topline { display: flex; justify-content: space-between; gap: .7rem; align-items: baseline; }
        .thread-topline strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; }
        .thread-row.unread .thread-topline strong, .thread-row.unread .thread-subject { font-weight: 900; color: white; }
        .thread-topline time { flex: 0 0 auto; color: var(--muted); font-size: .72rem; }
        .thread-subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); font-size: .84rem; }
        .thread-subject em { margin-left: .4rem; font-style: normal; color: var(--muted); font-size: .72rem; }
        .thread-snippet { color: var(--muted); font-size: .78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .thread-meta { color: #64748b; font-size: .7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .unread-pill { align-self: center; min-width: 24px; height: 24px; padding: 0 .4rem; border-radius: 999px; display: grid; place-items: center; background: #2563eb; color: white; font-size: .72rem; font-weight: 900; }
        .thread-view { min-width: 0; overflow-y: auto; max-height: calc(100vh - 10rem); background: #0d1015; }
        .thread-header { position: sticky; top: 0; z-index: 3; padding: 1.1rem 1.25rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; border-bottom: 1px solid var(--border); background: rgba(13,16,21,.95); backdrop-filter: blur(10px); }
        .thread-kicker { color: var(--muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
        .thread-header h2 { margin: .25rem 0 .35rem; font-size: 1.25rem; line-height: 1.3; }
        .thread-participants { color: var(--muted); font-size: .82rem; overflow-wrap: anywhere; }
        .thread-actions { display: flex; gap: .55rem; flex: 0 0 auto; }
        .small-button, .primary-reply, .send-button { border: 0; border-radius: 999px; padding: .62rem .95rem; font: inherit; font-weight: 800; cursor: pointer; }
        .small-button { background: rgba(255,255,255,.07); color: var(--text); }
        .primary-reply, .send-button { background: #f97316; color: #111827; }
        .primary-reply:disabled, .send-button:disabled { opacity: .45; cursor: not-allowed; }
        .message-stack { padding: 1rem 1.25rem .25rem; }
        .mail-message { display: grid; grid-template-columns: 42px minmax(0,1fr); gap: .8rem; padding: 1rem 0; border-bottom: 1px solid rgba(255,255,255,.065); }
        .message-body { min-width: 0; }
        .message-head { display: flex; justify-content: space-between; gap: 1rem; }
        .message-head > div { min-width: 0; display: flex; flex-direction: column; }
        .message-head strong { font-size: .9rem; overflow-wrap: anywhere; }
        .message-head span, .message-head time { color: var(--muted); font-size: .74rem; }
        .message-head time { flex: 0 0 auto; }
        .message-subject { margin-top: .55rem; color: #94a3b8; font-size: .72rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
        .mail-message pre { margin: .55rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: .9rem; line-height: 1.65; color: #e5e7eb; }
        .parent-message .message-avatar { background: rgba(37,99,235,.24); color: #bfdbfe; }
        .centre-message .message-avatar { background: rgba(249,115,22,.2); color: #fed7aa; }
        .attachment-list { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .75rem; }
        .attachment-list span { border: 1px solid var(--border); border-radius: 10px; padding: .35rem .55rem; color: var(--text-dim); font-size: .75rem; }
        .reply-composer { margin: 1rem 1.25rem 1.5rem; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: rgba(255,255,255,.025); }
        .reply-placeholder { width: 100%; border: 0; background: transparent; color: var(--muted); text-align: left; padding: 1rem; cursor: pointer; font: inherit; }
        .reply-placeholder:hover { background: rgba(255,255,255,.035); color: var(--text); }
        .composer-heading { display: flex; justify-content: space-between; align-items: center; padding: .75rem 1rem; border-bottom: 1px solid var(--border); }
        .composer-heading > div { display: flex; gap: .45rem; align-items: baseline; }
        .composer-heading span { color: var(--muted); font-size: .78rem; }
        .composer-close { border: 0; background: transparent; color: var(--muted); font-size: 1.35rem; cursor: pointer; }
        .reply-textarea { width: 100%; min-height: 150px; resize: vertical; border: 0; outline: 0; background: transparent; color: var(--text); padding: 1rem; font: inherit; line-height: 1.55; }
        .signature-grid { padding: 0 1rem 1rem; display: grid; grid-template-columns: minmax(180px,.7fr) minmax(260px,1.3fr); gap: .75rem; }
        .signature-grid label { display: flex; flex-direction: column; gap: .35rem; }
        .signature-grid label > span { color: var(--muted); font-size: .74rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
        .signature-grid small { text-transform: none; letter-spacing: 0; font-weight: 500; }
        .signature-grid input, .signature-grid textarea { border: 1px solid var(--border); border-radius: 10px; background: rgba(0,0,0,.22); color: var(--text); padding: .7rem .75rem; font: inherit; resize: vertical; }
        .signature-toggle { margin: 0 1rem .8rem; display: flex; align-items: center; gap: .5rem; color: var(--muted); font-size: .8rem; }
        .composer-footer { padding: .75rem 1rem; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
        .from-hint { color: var(--muted); font-size: .72rem; overflow-wrap: anywhere; }
        .send-notice { margin: -.6rem 1.25rem 1.25rem; color: #fecaca; font-size: .82rem; }
        .send-notice.success { color: #bbf7d0; }
        .empty-state { padding: 2.5rem 1rem; color: var(--muted); text-align: center; }
        .empty-state.detail { min-height: 420px; display: grid; place-items: center; }
        @media (max-width: 1120px) {
          .mail-app { grid-template-columns: 1fr; }
          .mail-sidebar { position: static; min-height: auto; display: flex; gap: .3rem; overflow-x: auto; }
          .sidebar-title, .sidebar-note { display: none; }
          .folder-button { width: auto; min-width: max-content; grid-template-columns: 22px auto auto; }
          .mail-split { grid-template-columns: minmax(330px,.9fr) minmax(470px,1.1fr); }
        }
        @media (max-width: 820px) {
          .mail-toolbar { grid-template-columns: 1fr 44px; }
          .toolbar-title { display: none; }
          .mail-split { grid-template-columns: 1fr; }
          .thread-list { max-height: 42vh; border-right: 0; border-bottom: 1px solid var(--border); }
          .thread-view { max-height: none; }
          .thread-header { position: static; flex-direction: column; }
          .signature-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
