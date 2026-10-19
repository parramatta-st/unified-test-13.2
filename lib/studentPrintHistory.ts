export type StudentPrintBatch = {
  batchId: string; ms: number; timestamp: string; student: string; tutor: string;
  year: string; subject: string; topic: string; folder: string; names: string[];
  qty: number; source: 'manual' | 'automatic'; ok: boolean; expected: number; sent: number;
};

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

/** Read only this campus and identity. Legacy rows lacking Member IDs can
 * still match by exact name; explicit IDs always take precedence. */
export function studentPrintBatches(rows: any[], campus: string, studentId: string, studentName: string): StudentPrintBatch[] {
  const groups = new Map<string, StudentPrintBatch & { contexts: Set<string>; contextualNames: string[] }>();
  const seen = new Set<string>();
  (rows || []).forEach((row, index) => {
    let raw: any = {};
    try { const parsed = JSON.parse(rowVal(row, 'Raw', 'raw') || '{}'); if (parsed && typeof parsed === 'object') raw = parsed; } catch {}
    const rowCampus = norm(raw.campusKey || rowVal(row, 'CampusKey', 'campusKey'));
    if (rowCampus && lower(rowCampus) !== lower(campus)) return;
    const rowId = norm(raw.studentId || raw.student_id || rowVal(row, 'StudentID', 'studentId'));
    const student = rowVal(row, 'Student', 'student') || norm(raw.student);
    if (studentId && rowId ? lower(studentId) !== lower(rowId) : !studentName || lower(student) !== lower(studentName)) return;
    const ok = ['true','yes','1','ok','success'].includes(lower(rowVal(row,'OK','ok') || String(raw.ok ?? '')));
    // Never present a failed or unknown acceptance as successful history.
    if (!ok) return;
    const timestamp = norm(raw.when || raw.timestamp || rowVal(row, 'Timestamp','timestamp','when'));
    const ms = raw.when && Number.isFinite(Date.parse(raw.when)) ? Date.parse(raw.when) : parseDate(timestamp);
    const source = raw.rollingPrint || raw.sourceForm === 'rolling-print-queue' ? 'automatic' : 'manual';
    const batchId = norm(raw.batchId) || `legacy-${index}`;
    const key = `${source}|${batchId}`;
    const eventId = norm(raw.material_path || raw.material_id);
    if (raw.batchId && eventId) { const unique = `${key}|${eventId}`; if (seen.has(unique)) return; seen.add(unique); }
    const names = parseArr(raw.names || raw.name || raw.materials || rowVal(row, 'Names','names','Types/MaterialID'));
    const context = [rowVal(row,'Year','year') || norm(raw.year), rowVal(row,'Subject','subject') || norm(raw.subject), rowVal(row,'Topic','topic') || norm(raw.topic || raw.strand)].filter(Boolean).join(' · ');
    const contextualNames = names.map(name => [context,name].filter(Boolean).join(' · '));
    const existing = groups.get(key);
    if (existing) {
      existing.ms = Math.max(existing.ms, ms);
      existing.names.push(...names);
      existing.contexts.add(context); existing.contextualNames.push(...contextualNames);
      existing.sent += Math.max(1, names.length);
    } else groups.set(key, {
      contexts: new Set([context]), contextualNames, batchId, ms, timestamp, student, tutor: rowVal(row,'Tutor','tutor') || norm(raw.tutor),
      year: rowVal(row,'Year','year') || norm(raw.year), subject: rowVal(row,'Subject','subject') || norm(raw.subject),
      topic: rowVal(row,'Topic','topic') || norm(raw.topic || raw.strand), folder: norm(raw.folder), names,
      qty: Number(raw.qty || rowVal(row,'Qty','qty')) || 1, source, ok: true,
      expected: Number(raw.batchStudentSize) || 0, sent: Math.max(1, names.length),
    });
  });
  return [...groups.values()].sort((a,b) => b.ms - a.ms).slice(0, 8).map(({ contexts, contextualNames, ...batch }) => contexts.size > 1 ? { ...batch, year:'',subject:'',topic:'',folder:'Mixed worksheets',names:contextualNames } : batch);
}
