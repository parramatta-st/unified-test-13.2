import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import nodemailer from 'nodemailer';
import { getAuthStatus } from '../../lib/auth';
import { loadMembers } from '../../lib/members';
import { appendFeedbackLog } from '../../lib/logs';
import { relayRouteKey } from '../../lib/replyRelay';
import { defaultCampusKey } from '../../lib/tutorConfig';

function norm(v: any) { return String(v || '').trim(); }
function lower(v: any) { return norm(v).toLowerCase(); }
// Email headers must never contain CR/LF (header injection).
function headerSafe(v: any) { return String(v || '').replace(/[\r\n]+/g, ' ').trim(); }

function enabled(v: any) {
  return /^(1|true|yes|on)$/i.test(norm(v));
}

function emailDomain(address: string) {
  const value = lower(address);
  const at = value.lastIndexOf('@');
  return at > 0 ? value.slice(at + 1) : '';
}

function campusLabel(campusName: string, campusKey: string) {
  const cleaned = headerSafe(campusName)
    .replace(/\bsuccess\b/gi, ' ')
    .replace(/\btutoring\b/gi, ' ')
    .replace(/\bcentre\b/gi, ' ')
    .replace(/\bcenter\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned) return cleaned;

  return headerSafe(campusKey)
    .replace(/^st[-_ ]*/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function senderDisplayName(campusName: string, campusKey: string) {
  const explicit = headerSafe(process.env.MAIL_FROM_NAME);
  if (explicit) return explicit;

  const label = campusLabel(campusName, campusKey);
  return label ? `${label} Success Tutoring` : 'Success Tutoring';
}

function aliasLocalPart(campusName: string, campusKey: string) {
  // Prefer the human-readable campus name so abbreviations such as `stgv` do
  // not leak into the sender address. `Success Tutoring Green Valley` and
  // `Green Valley Success Tutoring` both resolve to `greenvalley`.
  const fromName = lower(campusName)
    .replace(/\bsuccess\b/g, ' ')
    .replace(/\btutoring\b/g, ' ')
    .replace(/\bcentre\b/g, ' ')
    .replace(/\bcenter\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  if (fromName) return fromName;
  return lower(campusKey).replace(/[^a-z0-9]+/g, '');
}

function resolveFromAddress(user: string, campusName: string, campusKey: string) {
  const explicit = headerSafe(process.env.MAIL_FROM);
  if (explicit) return { address: explicit, source: 'MAIL_FROM' };

  const loginAddress = headerSafe(user);
  const loginDomain = emailDomain(loginAddress);
  const configuredDomain = lower(process.env.MAIL_FROM_DOMAIN).replace(/^@+/, '').replace(/[^a-z0-9.-]/g, '');

  // Automatically use centre aliases only for the shared Workspace domain
  // (or when MAIL_FROM_DOMAIN is explicitly configured). Personal Gmail and
  // legacy senders keep their existing behaviour.
  const aliasDomain = configuredDomain || (loginDomain === 'st-feedback.site' ? loginDomain : '');
  const localPart = aliasLocalPart(campusName, campusKey);
  if (aliasDomain && localPart) {
    return { address: `${localPart}@${aliasDomain}`, source: 'campus-alias' };
  }

  return { address: loginAddress, source: 'MAIL_USER' };
}

async function lookupParentEmail(name: string): Promise<string | undefined> {
  const loaded = await loadMembers();
  const rows = loaded.members || [];
  const target = lower(name);
  const targetFirst = target.split(/\s+/)[0] || target;

  for (const row of rows) {
    if (!row.active) continue;
    const first = norm(row.firstName);
    const full = `${first} ${norm(row.lastName)}`.trim();
    const email = norm(row.parentEmail);
    if (!full || !email) continue;
    const fullLc = lower(full);
    if (fullLc === target) return email;
    if (!target.includes(' ') && first && lower(first) === targetFirst) return email;
  }
  return undefined;
}

async function persistFeedbackLog(payload: any) {
  const privateLog = await appendFeedbackLog(payload).catch((err) => ({ saved: false, error: err?.message || 'private logging failed' }));
  if (privateLog.saved) return { logged: 'private-sheet', saved: true };

  const webhook = process.env.FEEDBACK_LOG_WEBHOOK_URL;
  if (!webhook) return { logged: 'not-configured', saved: false };

  try {
    const logRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!logRes.ok) {
      console.error('Feedback logging failed', await logRes.text());
      return { logged: 'webhook-failed', saved: false };
    }
    return { logged: 'webhook', saved: true };
  } catch (err) {
    console.error('Feedback logging error', err);
    return { logged: 'webhook-failed', saved: false };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required' });

  const { toName: toNameRaw, subject: subjectRaw, text, meta = {} } = req.body || {};
  const toName = headerSafe(toNameRaw);
  const subject = headerSafe(subjectRaw);
  if (!toName || !subject || !text) {
    return res.status(400).json({ ok: false, error: 'Missing fields' });
  }

  // Prefer the live member sheet over the client-supplied email. The client
  // value can come from a stale "recent students" cache in localStorage; if a
  // parent email was updated in Members, the live value must win. Custom /
  // non-member students fall back to the client-supplied email as before.
  const liveEmail = await lookupParentEmail(toName);
  const toEmail = liveEmail || headerSafe(meta?.parentEmail);
  if (!toEmail) {
    return res.status(400).json({ ok: false, error: 'Parent email not found for selected student' });
  }

  const user = headerSafe(process.env.MAIL_USER);
  const pass = process.env.MAIL_PASS || '';
  const campusKey = headerSafe(auth.campus || meta?.campusKey || defaultCampusKey());
  const campusName = headerSafe(process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring');
  const resolvedFrom = resolveFromAddress(user, campusName, campusKey);
  const fromAddress = resolvedFrom.address;
  const fromName = senderDisplayName(campusName, campusKey);
  const centreInbox = headerSafe(process.env.REPLY_TO || '');
  const relayRequested = enabled(process.env.REPLY_RELAY_ENABLED);
  if (relayRequested && !norm(process.env.REPLY_RELAY_SECRET)) {
    return res.status(500).json({ ok: false, error: 'Reply relay is enabled but REPLY_RELAY_SECRET is not configured.' });
  }
  const relayEnabled = relayRequested;
  const conversationId = crypto.randomUUID();
  const routeKey = relayRouteKey(campusKey) || 'centre';
  const relayToken = `${routeKey}-${crypto.randomBytes(16).toString('hex')}`;
  const relayDomain = lower(process.env.REPLY_RELAY_DOMAIN || emailDomain(fromAddress) || 'st-feedback.site')
    .replace(/^@+/, '')
    .replace(/[^a-z0-9.-]/g, '');
  const relayAddress = `reply+${relayToken}@${relayDomain}`;
  // Relay mode is deliberately feature-flagged. Until it is enabled for a
  // deployment, parents continue replying directly to the centre inbox.
  const replyTo = relayEnabled ? relayAddress : (centreInbox || fromAddress);

  if (!user || !pass) {
    return res.status(500).json({ ok: false, error: 'MAIL_USER/PASS not configured' });
  }

  const basePayload = {
    timestamp: new Date().toISOString(),
    campusKey,
    campusName: meta?.campusName || campusName,
    tutorName: meta?.tutorName || auth.tutor || '',
    studentId: meta?.studentId || '',
    studentName: meta?.studentName || toName || '',
    studentFirstName: meta?.studentFirstName || (String(toName).split(/\s+/)[0] || ''),
    studentLastName: meta?.studentLastName || '',
    studentYear: meta?.studentYear || '',
    parentName: meta?.parentName || '',
    parentEmail: toEmail,
    mode: meta?.mode || '',
    feedbackType: meta?.feedbackType || '',
    programKey: meta?.programKey || '',
    programLabel: meta?.programLabel || '',
    templateIndex: meta?.templateIndex || '',
    lessonNumber: meta?.lessonNumber || '',
    assessmentName: meta?.assessmentName || '',
    completionStatus: meta?.completionStatus || '',
    sourceForm: meta?.sourceForm || 'feedback',
    year: meta?.year || '',
    subject: meta?.subject || '',
    strand: meta?.strand || '',
    lesson: meta?.lesson || '',
    topic: meta?.topic || '',
    subjectLine: meta?.subjectLine || subject,
    fromName,
    fromAddress,
    replyTo,
    centreInbox,
    relayEnabled: relayEnabled ? 'TRUE' : 'FALSE',
    conversationId,
    relayToken,
    messageText: String(text),
  };

  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });

    console.info('Sending feedback email', {
      campusKey,
      fromName,
      fromAddress,
      fromSource: resolvedFrom.source,
      replyTo,
      relayEnabled,
      conversationId,
    });

    // Use an explicit mailbox string so the RFC From header always contains
    // the professional campus display name as well as the campus alias.
    const safeFromName = fromName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const info = await transporter.sendMail({
      from: `"${safeFromName}" <${fromAddress}>`,
      to: toEmail,
      replyTo,
      subject,
      text,
      headers: {
        'X-ST-Conversation-ID': conversationId,
        'X-ST-Relay-Token': relayToken,
        'X-ST-Campus-Key': campusKey,
        'X-ST-Relay-Enabled': relayEnabled ? '1' : '0',
      },
    });

    const payload = {
      ...basePayload,
      messageId: info?.messageId || '',
      sendStatus: 'sent',
    };
    const logResult = await persistFeedbackLog(payload);

    return res.status(200).json({
      ok: true,
      messageId: info?.messageId || '',
      conversationId,
      senderName: fromName,
      sender: fromAddress,
      replyTo,
      relayEnabled,
      senderSource: resolvedFrom.source,
      logged: logResult.logged,
    });
  } catch (e: any) {
    const failedPayload = {
      ...basePayload,
      messageId: '',
      sendStatus: 'failed',
    };
    const logResult = await persistFeedbackLog(failedPayload).catch(() => ({ logged: 'not-saved', saved: false }));
    return res.status(500).json({ ok: false, error: e?.message || 'send failed', logged: logResult.logged });
  }
}
