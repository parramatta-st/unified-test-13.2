import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadFeedbackLogRows } from '../../lib/logs';
import { defaultCampusKey, defaultCampusName } from '../../lib/tutorConfig';

function norm(value: any) { return String(value ?? '').trim(); }
function lower(value: any) { return norm(value).toLowerCase(); }
function keyName(value: any) { return lower(value).replace(/^\ufeff/, '').replace(/[^a-z0-9]+/g, ''); }

function readValue(row: any, ...keys: string[]) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && norm(row[key]) !== '') return norm(row[key]);
  }
  const wanted = new Set(keys.map(keyName));
  for (const [rawKey, value] of Object.entries(row || {})) {
    if (wanted.has(keyName(rawKey)) && value !== undefined && value !== null && norm(value) !== '') return norm(value);
  }
  return '';
}

function campusToken(value: any) {
  return lower(value)
    .replace(/\bsuccess\b/g, ' ')
    .replace(/\btutoring\b/g, ' ')
    .replace(/\bcentre\b/g, ' ')
    .replace(/\bcenter\b/g, ' ')
    .replace(/^st[-_ ]*/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function timestampMs(value: string) {
  const parsed = Date.parse(norm(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function statusValue(row: any) {
  const explicit = lower(readValue(row, 'sendStatus', 'Send Status', 'status', 'Status'));
  if (explicit === 'failed' || explicit === 'error') return 'failed';
  return 'sent';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required' });

  const rawLimit = Number(req.query.limit || 200);
  const limit = Math.min(300, Math.max(20, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 200));

  try {
    const loaded = await loadFeedbackLogRows();
    if (loaded.warning && !(loaded.rows || []).length) {
      return res.status(500).json({ ok: false, error: `Sent Feedback could not load the feedback log: ${loaded.warning}` });
    }

    const allowedCampusKeys = new Set([
      campusToken(auth.campus),
      campusToken(defaultCampusKey()),
    ].filter(Boolean));
    const allowedCampusNames = new Set([
      campusToken(process.env.NEXT_PUBLIC_CAMPUS_NAME || ''),
      campusToken(defaultCampusName()),
    ].filter(Boolean));

    const scopedRows = (loaded.rows || []).filter((row: any) => {
      const rowCampusKey = readValue(row, 'campusKey', 'Campus Key', 'campus', 'Campus');
      if (rowCampusKey) return allowedCampusKeys.has(campusToken(rowCampusKey));

      // Older log rows may have a centre name but no campus key. Only include
      // those when the name clearly resolves to this deployment's centre.
      const rowCampusName = readValue(row, 'campusName', 'Campus Name', 'centreName', 'Centre Name');
      return !!rowCampusName && allowedCampusNames.has(campusToken(rowCampusName));
    });

    const items = scopedRows
      .map((row: any, index: number) => {
        const timestamp = readValue(row, 'timestamp', 'Timestamp', 'when', 'When');
        const messageId = readValue(row, 'messageId', 'Message ID', 'message_id');
        const campusName = readValue(row, 'campusName', 'Campus Name') || process.env.NEXT_PUBLIC_CAMPUS_NAME || defaultCampusName();
        const studentName = readValue(row, 'studentName', 'Student Name', 'student', 'Student');
        const subjectLine = readValue(row, 'subjectLine', 'Subject Line', 'emailSubject', 'Email Subject');
        return {
          id: messageId || `${timestamp || 'row'}-${studentName || 'student'}-${index}`,
          timestamp,
          campusKey: readValue(row, 'campusKey', 'Campus Key', 'campus', 'Campus') || auth.campus,
          campusName,
          tutorName: readValue(row, 'tutorName', 'Tutor Name', 'tutor', 'Tutor'),
          studentId: readValue(row, 'studentId', 'Student ID'),
          studentName,
          studentYear: readValue(row, 'studentYear', 'Student Year', 'year', 'Year'),
          parentName: readValue(row, 'parentName', 'Parent Name'),
          parentEmail: readValue(row, 'parentEmail', 'Parent Email', 'email', 'Email'),
          fromName: readValue(row, 'fromName', 'From Name', 'senderName', 'Sender Name'),
          fromAddress: readValue(row, 'fromAddress', 'From Address', 'senderEmail', 'Sender Email', 'fromEmail', 'From Email'),
          replyTo: readValue(row, 'replyTo', 'Reply To', 'reply-to', 'Reply-To'),
          subjectLine,
          messageText: readValue(row, 'messageText', 'Message Text', 'emailBody', 'Email Body', 'feedbackText', 'Feedback Text', 'feedback', 'Feedback', 'text', 'Text'),
          sendStatus: statusValue(row),
          messageId,
          feedbackType: readValue(row, 'feedbackType', 'Feedback Type'),
          mode: readValue(row, 'mode', 'Mode'),
          programLabel: readValue(row, 'programLabel', 'Program Label'),
          lessonNumber: readValue(row, 'lessonNumber', 'Lesson Number'),
          assessmentName: readValue(row, 'assessmentName', 'Assessment Name'),
          completionStatus: readValue(row, 'completionStatus', 'Completion Status'),
          year: readValue(row, 'year', 'Year'),
          subject: readValue(row, 'subject', 'Subject'),
          strand: readValue(row, 'strand', 'Strand'),
          lesson: readValue(row, 'lesson', 'Lesson'),
          topic: readValue(row, 'topic', 'Topic'),
          sourceForm: readValue(row, 'sourceForm', 'Source Form'),
          sortMs: timestampMs(timestamp),
        };
      })
      .sort((a: any, b: any) => b.sortMs - a.sortMs)
      .slice(0, limit)
      .map(({ sortMs, ...item }: any) => item);

    return res.status(200).json({
      ok: true,
      items,
      total: scopedRows.length,
      campus: auth.campus,
      source: loaded.source || '',
      warning: loaded.warning || '',
    });
  } catch (error: any) {
    console.error('sent-feedback error', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Failed to load sent feedback.' });
  }
}