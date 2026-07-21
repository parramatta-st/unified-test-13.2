import { appendSheetRows, loadRowsPrivateFirst, privateSheetsConfigured, sheetNames, spreadsheetIdFor } from './googleSheets';

export const FEEDBACK_LOG_HEADERS = [
  'timestamp', 'campusKey', 'campusName', 'tutorName', 'studentId', 'studentName', 'studentFirstName', 'studentLastName', 'studentYear',
  'parentName', 'parentEmail', 'mode', 'feedbackType', 'programKey', 'programLabel', 'templateIndex', 'lessonNumber', 'assessmentName',
  'completionStatus', 'sourceForm', 'year', 'subject', 'strand', 'lesson', 'topic', 'subjectLine', 'messageId'
];

export const PRINT_LOG_HEADERS = [
  'Timestamp', 'Kind', 'Student', 'Tutor', 'Year', 'Subject', 'Topic', 'Types/MaterialID', 'Qty', 'Printer', 'OK', 'Raw'
];

function norm(v: any) { return String(v ?? '').trim(); }

function formatPrintLogTimestamp(value: any) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return norm(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.PRINT_LOG_TIME_ZONE || 'Australia/Sydney',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${part('month')}/${part('day')}/${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function printMaterialLabels(raw: any, names: any[], ids: any[]) {
  const direct = Array.isArray(raw.materials) ? raw.materials : Array.isArray(raw.types) ? raw.types : [];
  if (direct.length) return direct;
  const typeLabels = Array.isArray(raw.type_labels) ? raw.type_labels : [];
  return names.map((name, index) => {
    const type = typeLabels[index] || raw.type || '';
    return name && type ? `${type}: ${name}` : name || type || ids[index] || '';
  }).filter((value) => norm(value) !== '');
}

export async function loadFeedbackLogRows() {
  return loadRowsPrivateFirst({
    kind: 'FEEDBACK_LOG',
    sheetName: sheetNames.feedbackLog(),
    csvUrls: [
      process.env.FEEDBACK_PROGRESS_CSV_URL || '',
      process.env.NEXT_PUBLIC_FEEDBACK_PROGRESS_CSV_URL || '',
      process.env.FEEDBACK_LOG_CSV_URL || '',
      process.env.SENTMSGS_CSV_URL || '',
      process.env.NEXT_PUBLIC_SENTMSGS_CSV_URL || '',
    ],
  });
}

export async function loadPrintLogRows() {
  return loadRowsPrivateFirst({
    kind: 'PRINT_LOG',
    sheetName: sheetNames.printLog(),
    csvUrls: [
      process.env.PRINT_LOG_CSV_URL || '',
      process.env.PRINT_PROGRESS_CSV_URL || '',
      process.env.NEXT_PUBLIC_PRINT_LOG_CSV_URL || '',
      process.env.PRINT_LOG_READ_CSV_URL || '',
    ],
  });
}

export async function appendFeedbackLog(payload: any) {
  if (!privateSheetsConfigured()) return { saved: false, reason: 'private sheets not configured' };
  const row: Record<string, any> = { ...payload };
  row.timestamp = row.timestamp || row.when || new Date().toISOString();
  await appendSheetRows(sheetNames.feedbackLog(), FEEDBACK_LOG_HEADERS, [row], spreadsheetIdFor('FEEDBACK_LOG'));
  return { saved: true };
}

export function buildPrintLogRow(body: any) {
  const raw = body || {};
  const names = Array.isArray(raw.names) ? raw.names : raw.names ? [raw.names] : [];
  const ids = Array.isArray(raw.material_ids) ? raw.material_ids : raw.material_id ? [raw.material_id] : [];
  const materialLabels = printMaterialLabels(raw, names, ids);
  return {
    Timestamp: formatPrintLogTimestamp(raw.when || raw.timestamp),
    Kind: raw.kind || '',
    Student: raw.student || '',
    Tutor: raw.tutor || '',
    Year: raw.year || '',
    Subject: raw.subject || '',
    Topic: raw.topic || raw.strand || '',
    'Types/MaterialID': materialLabels.length ? JSON.stringify(materialLabels) : (ids.length ? JSON.stringify(ids) : (raw.type || raw.name || '')),
    Qty: raw.qty || '',
    Printer: raw.printer || '',
    OK: raw.ok === undefined ? '' : String(!!raw.ok).toUpperCase(),
    Raw: JSON.stringify(raw),
  };
}

export async function appendPrintLog(payload: any) {
  if (!privateSheetsConfigured()) return { saved: false, reason: 'private sheets not configured' };
  await appendSheetRows(sheetNames.printLog(), PRINT_LOG_HEADERS, [buildPrintLogRow(payload)], spreadsheetIdFor('PRINT_LOG'));
  return { saved: true };
}
