import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadFeedbackLogRows } from '../../lib/logs';

function norm(v:any){ return String(v || '').trim(); }
function lower(v:any){ return norm(v).toLowerCase(); }

const ADMIN_TZ = 'Australia/Sydney';

function getTimeZoneOffsetMs(dateMs:number, timeZone:string){
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts:any = {};
  for (const p of dtf.formatToParts(new Date(dateMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - dateMs;
}

function localSydneyMs(year:number, month:number, day:number, hour:number, minute:number, second:number){
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getTimeZoneOffsetMs(guess, ADMIN_TZ);
  let ms = guess - offset;
  offset = getTimeZoneOffsetMs(ms, ADMIN_TZ);
  ms = guess - offset;
  return ms;
}

function parseSheetDate(v:any){
  const s = norm(v);
  if (!s) return 0;

  // Google Sheets published CSVs for these logs export dates like M/D/YYYY H:mm:ss.
  // Parse these as local Australia/Sydney wall time BEFORE Date.parse, otherwise JS
  // treats them as UTC/US browser time and the admin dashboard can show the next day.
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    // Prefer M/D/YYYY because your log sheet examples use 5/26/2026 and 6/1/2026.
    // If the first number is > 12, gracefully treat it as D/M/YYYY.
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    let h = Number(m[4] || 0);
    const min = Number(m[5] || 0);
    const sec = Number(m[6] || 0);
    const ap = lower(m[7] || '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return localSydneyMs(y, month, day, h, min, sec);
    }
  }

  const direct = Date.parse(s);
  return Number.isFinite(direct) ? direct : 0;
}

function parseDate(v:any){ return parseSheetDate(v); }

async function loadRows(){
  const result = await loadFeedbackLogRows();
  return { rows: result.rows || [], sourceConfigured: result.configured };
}

function rowVal(row:any, ...keys:string[]){
  for (const k of keys){
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  if (req.method !== 'POST') return res.status(405).end();
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok:false, error:'Login required' });
  const body = req.body || {};
  const studentName = lower(body.studentName || body.toName);
  const parentEmail = lower(body.parentEmail);
  const year = lower(body.year);
  const subject = lower(body.subject);
  const strand = lower(body.strand);
  const lesson = lower(body.lesson);
  const topic = lower(body.topic);

  if (!studentName || !year || !subject || !lesson) return res.status(200).json({ ok:true, duplicates: [], skipped: 'insufficient fields' });

  try{
    const { rows, sourceConfigured } = await loadRows();
    if (!sourceConfigured) return res.status(200).json({ ok:true, duplicates: [], skipped: 'FEEDBACK_PROGRESS_CSV_URL not configured' });

    const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 90;
    const duplicates = (rows || [])
      .map((row:any) => {
        const tsRaw = rowVal(row, 'timestamp', 'Timestamp', 'when');
        const ms = parseDate(tsRaw);
        return {
          row,
          ms,
          timestamp: tsRaw,
          studentName: rowVal(row, 'studentName', 'student', 'Student'),
          parentEmail: rowVal(row, 'parentEmail', 'Email', 'email'),
          tutorName: rowVal(row, 'tutorName', 'Tutor', 'tutor'),
          year: rowVal(row, 'year', 'Year'),
          subject: rowVal(row, 'subject', 'Subject'),
          strand: rowVal(row, 'strand', 'Strand'),
          lesson: rowVal(row, 'lessonNumber', 'lesson', 'Lesson'),
          topic: rowVal(row, 'topic', 'Topic'),
          subjectLine: rowVal(row, 'subjectLine', 'Subject Line'),
        };
      })
      .filter((r) => {
        // Rows whose timestamp cannot be parsed (ms = 0) previously slipped
        // past the 90-day cutoff and warned as "duplicates" forever.
        if (!r.ms || r.ms < cutoff) return false;
        const sameStudent = parentEmail
          ? lower(r.parentEmail) === parentEmail
          : lower(r.studentName) === studentName;
        if (!sameStudent) return false;
        if (lower(r.year) !== year) return false;
        if (lower(r.subject) !== subject) return false;
        if (lower(r.lesson) !== lesson) return false;
        // Strand OR topic may be the lesson family depending on old/current log versions.
        const strandOrTopicMatch = !strand && !topic
          ? true
          : [lower(r.strand), lower(r.topic)].includes(strand) || [lower(r.strand), lower(r.topic)].includes(topic);
        return strandOrTopicMatch;
      })
      .sort((a,b) => (b.ms || 0) - (a.ms || 0))
      .slice(0, 5);

    return res.status(200).json({ ok:true, duplicates });
  } catch(e:any){
    return res.status(200).json({ ok:true, duplicates: [], warning: e?.message || 'duplicate check failed' });
  }
}
