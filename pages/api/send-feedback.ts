import type { NextApiRequest, NextApiResponse } from 'next';
import nodemailer from 'nodemailer';
import { getAuthStatus } from '../../lib/auth';
import { loadMembers } from '../../lib/members';
import { appendFeedbackLog } from '../../lib/logs';
import { defaultCampusKey } from '../../lib/tutorConfig';

function norm(v: any) { return String(v || '').trim(); }
function lower(v: any) { return norm(v).toLowerCase(); }
// Email headers must never contain CR/LF (header injection).
function headerSafe(v: any) { return String(v || '').replace(/[\r\n]+/g, ' ').trim(); }

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

  const user = process.env.MAIL_USER || '';
  const pass = process.env.MAIL_PASS || '';
  const replyTo = process.env.REPLY_TO || user;
  const campusName = process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring';

  if (!user || !pass) {
    return res.status(500).json({ ok: false, error: 'MAIL_USER/PASS not configured' });
  }

  try {
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });

    const info = await transporter.sendMail({ from: `${campusName} <${user}>`, to: toEmail, replyTo, subject, text });

    const payload = {
      timestamp: new Date().toISOString(),
      campusKey: auth.campus || meta?.campusKey || defaultCampusKey(),
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
      messageId: info?.messageId || '',
    };

    const privateLog = await appendFeedbackLog(payload).catch((err) => ({ saved: false, error: err?.message || 'private logging failed' }));
    const webhook = process.env.FEEDBACK_LOG_WEBHOOK_URL;
    if (!privateLog.saved && webhook) {
      try {
        const logRes = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!logRes.ok) console.error('Feedback logging failed', await logRes.text());
      } catch (err) {
        console.error('Feedback logging error', err);
      }
    }

    return res.status(200).json({ ok: true, messageId: info?.messageId || '', logged: privateLog.saved ? 'private-sheet' : webhook ? 'webhook' : 'not-configured' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'send failed' });
  }
}
