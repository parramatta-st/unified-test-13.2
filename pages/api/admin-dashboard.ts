import type { NextApiRequest, NextApiResponse } from 'next';
import { loadFeedbackLogRows, loadPrintLogRows } from '../../lib/logs';
import { requireAdmin } from '../../lib/adminAuth';

function norm(v:any){ return String(v || '').trim(); }
function lower(v:any){ return norm(v).toLowerCase(); }
function rowVal(row:any, ...keys:string[]){
  for (const k of keys){
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

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
function dayKey(ms:number){
  if (!ms) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone:ADMIN_TZ, year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(ms));
}
function isToday(ms:number){ return dayKey(ms) === dayKey(Date.now()); }
function parseJsonArray(value:any): any[] {
  if (Array.isArray(value)) return value;
  const s = norm(value);
  if (!s) return [];
  try { const parsed = JSON.parse(s); return Array.isArray(parsed) ? parsed : [parsed]; }
  catch { return [s]; }
}


export default async function handler(req: NextApiRequest, res: NextApiResponse){
  const admin = await requireAdmin(req);
  if (!admin.isAdmin) return res.status(403).json({ ok:false, error:'Admin access required' });

  try{
    const [feedbackLoaded, printLoaded] = await Promise.all([
      loadFeedbackLogRows(),
      loadPrintLogRows(),
    ]);
    const feedbackRows = feedbackLoaded.rows || [];
    const printRows = printLoaded.rows || [];

    const feedbackEvents = (feedbackRows || []).map((row:any) => {
      const ms = parseDate(rowVal(row, 'timestamp', 'Timestamp', 'when'));
      return {
        ms,
        timestamp: rowVal(row, 'timestamp', 'Timestamp', 'when'),
        tutorName: rowVal(row, 'tutorName', 'Tutor', 'tutor'),
        studentName: rowVal(row, 'studentName', 'student', 'Student'),
        parentEmail: rowVal(row, 'parentEmail', 'Email', 'email'),
        year: rowVal(row, 'year', 'Year'),
        subject: rowVal(row, 'subject', 'Subject'),
        strand: rowVal(row, 'strand', 'Strand'),
        topic: rowVal(row, 'topic', 'Topic'),
        lesson: rowVal(row, 'lessonNumber', 'lesson', 'Lesson'),
        subjectLine: rowVal(row, 'subjectLine', 'Subject Line'),
      };
    }).filter(e => e.studentName || e.subjectLine);

    const printEvents = (printRows || []).map((row:any) => {
      const raw = rowVal(row, 'Raw', 'raw');
      let parsed:any = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch {}
      const ms = parseDate(rowVal(row, 'Timestamp', 'timestamp', 'when') || parsed.when);
      const kind = rowVal(row, 'Kind', 'kind') || parsed.kind;
      const student = rowVal(row, 'Student', 'student') || parsed.student;
      const tutor = rowVal(row, 'Tutor', 'tutor') || parsed.tutor;
      const okRaw = rowVal(row, 'OK', 'ok') || String(parsed.ok ?? '');
      // Legacy rows can have a blank OK column. Blank means "unknown", not
      // "failed" — only an explicit false-y value should count as a failure.
      const okKnown = norm(okRaw) !== '';
      const ok = ['true', 'yes', '1'].includes(lower(okRaw));
      const names = parseJsonArray(parsed.names || parsed.material_names || parsed.materials || rowVal(row, 'Names', 'names'));
      const ids = parseJsonArray(parsed.material_ids || parsed.material_id || rowVal(row, 'Types/MaterialID', 'material_id'));
      const colorModes = parseJsonArray(parsed.colorModeLabels || parsed.printColorModes || parsed.print_color_modes || parsed.printColorMode || parsed.print_color_mode || rowVal(row, 'PrintColorMode', 'printColorMode', 'ColorMode', 'colorMode'));
      return {
        ms,
        timestamp: rowVal(row, 'Timestamp', 'timestamp', 'when') || parsed.when || '',
        kind,
        student,
        tutor,
        year: rowVal(row, 'Year', 'year') || parsed.year || '',
        subject: rowVal(row, 'Subject', 'subject') || parsed.subject || '',
        topic: rowVal(row, 'Topic', 'topic') || parsed.topic || '',
        folder: parsed.folder || rowVal(row, 'Folder', 'folder') || '',
        qty: rowVal(row, 'Qty', 'qty') || parsed.qty || '',
        ok,
        okKnown,
        names,
        ids,
        colorModes,
        raw: raw || JSON.stringify(parsed || {}),
      };
    }).filter(e => e.kind || e.student);

    const todayFeedback = feedbackEvents.filter(e => isToday(e.ms));
    const todayPrints = printEvents.filter(e => isToday(e.ms));
    const todayStudents = new Set(todayPrints.map(e => lower(e.student)).filter(Boolean));

    return res.status(200).json({
      ok:true,
      tutor: admin.tutor,
      sources: {
        feedbackConfigured: !!feedbackLoaded.configured,
        printConfigured: !!printLoaded.configured,
        feedbackSource: feedbackLoaded.source,
        printSource: printLoaded.source,
      },
      today: {
        feedbackSent: todayFeedback.length,
        prints: todayPrints.length,
        studentsPrinted: todayStudents.size,
      },
      recentFeedback: feedbackEvents.sort((a,b)=>(b.ms||0)-(a.ms||0)).slice(0,20),
      recentPrints: printEvents.sort((a,b)=>(b.ms||0)-(a.ms||0)).slice(0,20),
      failedPrints: printEvents.filter(e => e.okKnown && !e.ok).sort((a,b)=>(b.ms||0)-(a.ms||0)).slice(0,20),
    });
  } catch(e:any){
    return res.status(500).json({ ok:false, error:e?.message || 'Failed to build admin dashboard' });
  }
}
