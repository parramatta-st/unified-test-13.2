import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import { loadPrintLogRows } from '../../lib/logs';

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
function rowVal(row:any, ...keys:string[]){
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim();
  return '';
}
function parseArr(v:any): string[] {
  if (Array.isArray(v)) return v.map(norm).filter(Boolean);
  const s = norm(v);
  if (!s) return [];
  try { const p = JSON.parse(s); return Array.isArray(p) ? p.map(norm).filter(Boolean) : [norm(p)].filter(Boolean); }
  catch { return [s]; }
}
async function loadRows(){
  const result = await loadPrintLogRows();
  return { rows: result.rows || [], configured: result.configured, warning: (result as any).warning || '' };
}

export default async function handler(req:NextApiRequest, res:NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok:false, error:'Login required' });

  const studentName = lower(req.query.studentName);
  if (!studentName) return res.status(400).json({ ok:false, error:'Missing studentName' });
  try {
    const loaded = await loadRows();
    if (!loaded.configured) return res.status(200).json({ ok:true, prints: [], skipped:'PRINT_LOG_CSV_URL or private print log sheet not configured' });
    const prints = (loaded.rows || []).map((row:any) => {
      const raw = rowVal(row, 'Raw', 'raw');
      let j:any = {};
      try { j = raw ? JSON.parse(raw) : {}; } catch {}
      const ms = parseDate(rowVal(row, 'Timestamp', 'timestamp', 'when') || j.when);
      const student = rowVal(row, 'Student', 'student') || j.student || '';
      return {
        ms,
        timestamp: rowVal(row, 'Timestamp', 'timestamp', 'when') || j.when || '',
        student,
        tutor: rowVal(row, 'Tutor', 'tutor') || j.tutor || '',
        year: rowVal(row, 'Year', 'year') || j.year || '',
        subject: rowVal(row, 'Subject', 'subject') || j.subject || '',
        topic: rowVal(row, 'Topic', 'topic') || j.topic || '',
        folder: j.folder || rowVal(row, 'Folder', 'folder') || '',
        names: parseArr(j.names || j.materials || rowVal(row, 'Names', 'names')),
        ok: ['true','yes','1'].includes(lower(rowVal(row, 'OK', 'ok') || String(j.ok ?? ''))),
      };
    }).filter(p => lower(p.student) === studentName)
      .sort((a,b) => (b.ms || 0) - (a.ms || 0))
      .slice(0, 8);
    return res.status(200).json({ ok:true, prints });
  } catch(e:any) {
    return res.status(200).json({ ok:true, prints: [], warning:e?.message || 'failed' });
  }
}
