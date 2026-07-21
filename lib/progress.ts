import Papa from 'papaparse';

export type ProgressCsvRow = Record<string, string>;

export type StudentLookup = {
  studentId?: string;
  studentName?: string;
  parentEmail?: string;
};

export type ProgressEvent = {
  messageId: string;
  timestampLabel: string;
  timestampIso: string;
  timestampMs: number;
  campusKey: string;
  campusName: string;
  tutorName: string;
  studentId: string;
  studentName: string;
  studentFirstName: string;
  studentLastName: string;
  studentYear: string;
  parentName: string;
  parentEmail: string;
  mode: string;
  feedbackType: string;
  programKey: string;
  programLabel: string;
  programFamilyKey: string;
  templateIndex: string;
  lessonNumber: string;
  lessonOrder: number | null;
  assessmentName: string;
  completionStatus: string;
  sourceForm: string;
  year: string;
  subject: string;
  strand: string;
  lesson: string;
  topic: string;
  subjectLine: string;
};

export type ProgressProgramStatus = 'in_progress' | 'completed' | 'moved_on_without_assessment';

export type ProgressProgramEvent = {
  id: string;
  kind: 'lesson' | 'assessment';
  label: string;
  topic: string;
  tutorName: string;
  timestampIso: string;
  timestampLabel: string;
};

export type ProgressProgram = {
  id: string;
  title: string;
  year: string;
  subject: string;
  status: ProgressProgramStatus;
  startedAt: string;
  lastActivityAt: string;
  eventCount: number;
  events: ProgressProgramEvent[];
};

export type ProgressSubjectSection = {
  key: string;
  label: string;
  programs: ProgressProgram[];
};

export type StudentProgressResult = {
  student: {
    studentId: string;
    studentName: string;
    parentEmail: string;
  };
  subjects: ProgressSubjectSection[];
  totalPrograms: number;
  totalEvents: number;
};

export function normalizeSpace(value: string) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLower(value: string) {
  return normalizeSpace(value).toLowerCase();
}

function slugify(value: string) {
  return normalizeLower(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pick(row: ProgressCsvRow, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]);
    }
  }
  return '';
}

export function normalizeObjectKeys(input: any): ProgressCsvRow {
  const out: ProgressCsvRow = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    out[normalizeSpace(String(rawKey))] = String(rawValue ?? '');
  }
  return out;
}

function getSydneyOffsetMs(dateMs: number) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(dateMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
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

function localSydneyMs(year: number, month: number, day: number, hour: number, minute: number, second: number) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = getSydneyOffsetMs(guess);
  let ms = guess - offset;
  offset = getSydneyOffsetMs(ms);
  return guess - offset;
}

function parseTimestamp(value: string) {
  const trimmed = normalizeSpace(value);
  if (!trimmed) return { iso: '', ms: 0 };

  // Google Sheets logs used here export dates like M/D/YYYY H:mm:ss (e.g. 6/1/2026).
  // Treat these as Australia/Sydney local wall time before trying Date.parse, otherwise
  // JavaScript can display them as the next day in Sydney.
  const sheetMatch = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (sheetMatch) {
    const a = Number(sheetMatch[1]);
    const b = Number(sheetMatch[2]);
    let year = Number(sheetMatch[3]);
    if (year < 100) year += 2000;
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    let hour = Number(sheetMatch[4] || 0);
    const minute = Number(sheetMatch[5] || 0);
    const second = Number(sheetMatch[6] || 0);
    const ampm = normalizeLower(sheetMatch[7] || '');
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const ms = localSydneyMs(year, month, day, hour, minute, second);
      return { iso: new Date(ms).toISOString(), ms };
    }
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return { iso: new Date(parsed).toISOString(), ms: parsed };
  }

  return { iso: '', ms: 0 };
}

function parseYearRank(value: string): number | null {
  const trimmed = normalizeLower(value);
  if (!trimmed) return null;
  if (trimmed === 'kindy' || trimmed === 'kindergarten' || trimmed === 'k') return 0;

  const yearMatch = trimmed.match(/year\s*(\d{1,2})/);
  if (yearMatch) return Number(yearMatch[1]);

  const numberMatch = trimmed.match(/^(\d{1,2})$/);
  if (numberMatch) return Number(numberMatch[1]);

  return null;
}

function parseLessonOrder(value: string): number | null {
  const trimmed = normalizeLower(value);
  if (!trimmed) return null;
  const match = trimmed.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function isAssessmentValue(value: string) {
  return normalizeLower(value) === 'assessment';
}

function rawCellLooksLikeFeedback(rawCell: string) {
  if (!rawCell) return false;
  try {
    const parsed = JSON.parse(rawCell);
    const kind = normalizeLower(parsed?.kind || '');
    const feedbackType = normalizeLower(parsed?.feedbackType || '');
    const sourceForm = normalizeLower(parsed?.sourceForm || '');
    return kind === 'feedback' || !!feedbackType || !!parsed?.programKey || sourceForm === 'feedback';
  } catch {
    return false;
  }
}

function rawCellLooksLikePrint(rawCell: string) {
  if (!rawCell) return false;
  try {
    const parsed = JSON.parse(rawCell);
    const kind = normalizeLower(parsed?.kind || '');
    return kind === 'print' || kind === 'print-topic' || kind === 'print_topic';
  } catch {
    return false;
  }
}

function isLikelyPrintLog(fields: string[], rows: ProgressCsvRow[]) {
  const normalized = fields.map((field) => normalizeLower(field));
  const hasRaw = normalized.includes('raw');
  const hasKind = normalized.includes('kind');
  const hasFeedbackColumns = ['feedbacktype', 'programkey', 'studentname', 'subjectline', 'lessonnumber'].some((field) => normalized.includes(field));
  const hasPrintColumns = ['printer', 'qty', 'material_id', 'materialid', 'types/materialid'].some((field) => normalized.includes(field));

  if (hasFeedbackColumns) return false;

  let sawFeedbackRow = false;
  let sawPrintRow = false;
  for (const row of (rows || []).slice(0, 75)) {
    const kind = normalizeLower(pick(row, ['kind', 'Kind']));
    if (kind === 'feedback') sawFeedbackRow = true;
    if (kind === 'print' || kind === 'print-topic' || kind === 'print_topic') sawPrintRow = true;

    const raw = pick(row, ['Raw', 'raw']);
    if (rawCellLooksLikeFeedback(raw)) sawFeedbackRow = true;
    if (rawCellLooksLikePrint(raw)) sawPrintRow = true;
  }

  if (sawFeedbackRow) return false;
  return hasRaw && hasKind && (hasPrintColumns || sawPrintRow);
}

export function appendCacheBust(url: string) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_cb=${Date.now()}`;
}

export function resolveGoogleSheetsCsvUrl(rawUrl: string, preferredSheetName?: string) {
  const trimmed = normalizeSpace(rawUrl);
  if (!trimmed) return '';

  if (/tqx=out:csv/i.test(trimmed) || /format=csv/i.test(trimmed) || /output=csv/i.test(trimmed)) {
    return appendCacheBust(trimmed);
  }

  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return appendCacheBust(trimmed);

  const spreadsheetId = match[1];
  const sheetName = normalizeSpace(preferredSheetName || '');

  // When we know the target sheet tab, prefer it over any gid from a copied browser URL.
  if (sheetName) {
    return appendCacheBust(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
    );
  }

  const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/i);
  const gid = gidMatch ? gidMatch[1] : '';
  if (gid) {
    return appendCacheBust(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`);
  }

  return appendCacheBust(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`);
}

export function parseProgressCsv(text: string) {
  const parsed = Papa.parse<ProgressCsvRow>(text || '', {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => normalizeSpace(header),
  });

  const fields = (parsed.meta.fields || []).map((field) => normalizeSpace(field));

  const rows = (parsed.data || []).map((row) => normalizeObjectKeys(row)) as ProgressCsvRow[];

  return {
    fields,
    rows,
    looksLikePrintLog: isLikelyPrintLog(fields, rows),
  };
}

export function parseProgressJson(text: string) {
  const parsed = JSON.parse(text || 'null');
  const rowsSource = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.rows)
      ? parsed.rows
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.items)
          ? parsed.items
          : [];

  let rows: ProgressCsvRow[] = [];

  // Apps Script endpoints sometimes return `[headers, ...rows]` instead of
  // an array of objects. Convert that shape into normal keyed rows too.
  if (Array.isArray(rowsSource?.[0])) {
    const headers = (rowsSource[0] || []).map((header: any) => normalizeSpace(String(header || '')));
    rows = (rowsSource.slice(1) || []).map((values: any[]) => {
      const row: ProgressCsvRow = {};
      headers.forEach((header: string, index: number) => {
        if (header) row[header] = String(values?.[index] ?? '');
      });
      return normalizeObjectKeys(row);
    });
  } else {
    rows = (rowsSource || []).map((row: any) => normalizeObjectKeys(row)) as ProgressCsvRow[];
  }

  const fieldSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) fieldSet.add(normalizeSpace(key));
  }
  const fields = [...fieldSet];

  return {
    fields,
    rows,
    looksLikePrintLog: isLikelyPrintLog(fields, rows),
  };
}

export function parseProgressText(text: string) {
  const trimmed = normalizeSpace(text || '');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseProgressJson(text);
    } catch {
      // Fall through to CSV parsing so a malformed JSON-looking response still
      // produces a useful data-source error instead of crashing the API route.
    }
  }

  return parseProgressCsv(text);
}

function deriveStructuredRow(row: ProgressCsvRow): ProgressCsvRow {
  const rawCell = pick(row, ['Raw', 'raw']);
  if (!rawCell) return row;

  const alreadyStructured =
    normalizeSpace(pick(row, ['subject'])) &&
    (normalizeSpace(pick(row, ['feedbackType'])) || normalizeSpace(pick(row, ['programKey'])));
  if (alreadyStructured) return row;

  try {
    const parsedRaw = JSON.parse(rawCell);
    return normalizeObjectKeys({
      ...parsedRaw,
      timestamp: parsedRaw.timestamp || pick(row, ['Timestamp', 'timestamp', 'when']),
    });
  } catch {
    return row;
  }
}

export function normalizeProgressRows(rows: ProgressCsvRow[]) {
  const seenMessageIds = new Set<string>();
  const events: ProgressEvent[] = [];

  for (const originalRow of rows || []) {
    const row = deriveStructuredRow(originalRow);
    const timestamp = parseTimestamp(pick(row, ['timestamp', 'Timestamp', 'when']));
    if (!timestamp.ms) continue;

    const mode = normalizeLower(pick(row, ['mode']));
    const rawFeedbackType = normalizeLower(pick(row, ['feedbackType', 'kind']));
    if (mode === 'custom' || rawFeedbackType === 'custom') continue;

    const subject = normalizeSpace(pick(row, ['subject', 'Subject']));
    const programLabel = normalizeSpace(pick(row, ['programLabel', 'strand', 'Strand']));
    const year = normalizeSpace(pick(row, ['year', 'Year']));
    const studentName = normalizeSpace(pick(row, ['studentName', 'student', 'Student']));
    const messageId = normalizeSpace(pick(row, ['messageId']));

    if (!subject || !programLabel || !year || !studentName) continue;

    if (messageId) {
      if (seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);
    }

    const lessonRaw = normalizeSpace(pick(row, ['lesson']));
    const lessonNumber = normalizeSpace(pick(row, ['lessonNumber'])) || lessonRaw;
    const topicRaw = normalizeSpace(pick(row, ['topic', 'Topic']));

    const feedbackType = rawFeedbackType === 'feedback'
      ? (isAssessmentValue(lessonRaw) || isAssessmentValue(topicRaw) ? 'assessment' : 'curriculum_lesson')
      : (rawFeedbackType || (isAssessmentValue(lessonRaw) || isAssessmentValue(topicRaw) ? 'assessment' : 'curriculum_lesson'));

    const programKey = normalizeSpace(pick(row, ['programKey'])) || slugify(`${subject} ${programLabel} ${year}`);
    const programFamilyKey = slugify(`${subject} ${programLabel}`);
    const assessmentName = normalizeSpace(pick(row, ['assessmentName'])) || (feedbackType === 'assessment' ? (topicRaw || lessonRaw || 'Assessment') : '');

    events.push({
      messageId,
      timestampLabel: normalizeSpace(pick(row, ['timestamp', 'Timestamp', 'when'])),
      timestampIso: timestamp.iso,
      timestampMs: timestamp.ms,
      campusKey: normalizeSpace(pick(row, ['campusKey'])),
      campusName: normalizeSpace(pick(row, ['campusName'])),
      tutorName: normalizeSpace(pick(row, ['tutorName', 'tutor', 'Tutor'])),
      studentId: normalizeSpace(pick(row, ['studentId'])),
      studentName,
      studentFirstName: normalizeSpace(pick(row, ['studentFirstName'])),
      studentLastName: normalizeSpace(pick(row, ['studentLastName'])),
      studentYear: normalizeSpace(pick(row, ['studentYear'])),
      parentName: normalizeSpace(pick(row, ['parentName'])),
      parentEmail: normalizeSpace(pick(row, ['parentEmail'])),
      mode,
      feedbackType,
      programKey,
      programLabel,
      programFamilyKey,
      templateIndex: normalizeSpace(String(pick(row, ['templateIndex']))),
      lessonNumber,
      lessonOrder: parseLessonOrder(lessonNumber),
      assessmentName,
      completionStatus: normalizeLower(pick(row, ['completionStatus'])),
      sourceForm: normalizeLower(pick(row, ['sourceForm'])),
      year,
      subject,
      strand: normalizeSpace(pick(row, ['strand', 'Strand'])),
      lesson: lessonRaw,
      topic: topicRaw,
      subjectLine: normalizeSpace(pick(row, ['subjectLine'])),
    });
  }

  return events;
}

function namesMatchWithEmail(targetName: string, eventName: string, targetFirstName: string, eventFirstName: string) {
  if (targetName && eventName && targetName === eventName) return true;
  if (targetFirstName && eventFirstName && targetFirstName === eventFirstName) return true;
  if (targetName && eventFirstName && targetName === eventFirstName) return true;
  if (targetFirstName && eventName && eventName.startsWith(targetFirstName + ' ')) return true;
  return false;
}

function isSingleTokenName(value: string) {
  return !!value && !/\s/.test(value);
}

function matchesStudent(event: ProgressEvent, target: StudentLookup) {
  const targetId = normalizeSpace(target.studentId || '');
  const targetName = normalizeLower(target.studentName || '');
  const targetEmail = normalizeLower(target.parentEmail || '');
  const targetFirstName = normalizeLower((target.studentName || '').split(/\s+/)[0] || '');

  // Do NOT match by studentId because contact sheet IDs can be reassigned when the contacts list is rebuilt.
  // Match by stable student full name and/or parent email instead.

  const eventName = normalizeLower(event.studentName || '');
  const eventFirstName = normalizeLower(event.studentFirstName || event.studentName.split(/\s+/)[0] || '');
  const eventEmail = normalizeLower(event.parentEmail || '');
  const emailMatches = !!targetEmail && !!eventEmail && eventEmail === targetEmail;
  const exactFullName = !!targetName && !!eventName && targetName === eventName;

  // Exact full-name matches should still count when older logs did not store parentEmail.
  if (exactFullName) return true;

  if (emailMatches) {
    if (!targetName) return true;
    return namesMatchWithEmail(targetName, eventName, targetFirstName, eventFirstName);
  }

  // Avoid mixing siblings or students who share a first name. Only fall back to
  // first-name matching when both the selected student and old log are first-name-only.
  if (isSingleTokenName(targetName) && isSingleTokenName(eventName) && targetFirstName && targetFirstName === eventFirstName) {
    return true;
  }

  return false;
}

function buildProgramEvent(event: ProgressEvent): ProgressProgramEvent {
  const kind = event.feedbackType === 'assessment' ? 'assessment' : 'lesson';
  return {
    id: event.messageId || `${event.programKey}-${event.timestampMs}-${event.lessonNumber || event.assessmentName}`,
    kind,
    label: kind === 'assessment' ? 'Assessment' : event.lessonNumber ? `Lesson ${event.lessonNumber}` : 'Lesson',
    topic: kind === 'assessment'
      ? (event.assessmentName || event.topic || 'Assessment')
      : (event.topic || event.lesson || 'Lesson'),
    tutorName: event.tutorName,
    timestampIso: event.timestampIso,
    timestampLabel: event.timestampLabel || event.timestampIso,
  };
}

function compareProgramEvents(a: ProgressEvent, b: ProgressEvent) {
  const aAssessment = a.feedbackType === 'assessment';
  const bAssessment = b.feedbackType === 'assessment';
  if (aAssessment !== bAssessment) return aAssessment ? 1 : -1;

  if (!aAssessment && !bAssessment) {
    const aLesson = a.lessonOrder ?? Number.MAX_SAFE_INTEGER;
    const bLesson = b.lessonOrder ?? Number.MAX_SAFE_INTEGER;
    if (aLesson !== bLesson) return aLesson - bLesson;
  }

  return a.timestampMs - b.timestampMs;
}

export function buildStudentProgress(events: ProgressEvent[], target: StudentLookup): StudentProgressResult {
  const filtered = events.filter((event) => matchesStudent(event, target));

  const groups = new Map<string, {
    subject: string;
    programKey: string;
    programLabel: string;
    programFamilyKey: string;
    year: string;
    startMs: number;
    lastMs: number;
    completed: boolean;
    events: ProgressEvent[];
  }>();

  for (const event of filtered) {
    const key = event.programKey || slugify(`${event.subject} ${event.programLabel} ${event.year}`);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        subject: event.subject,
        programKey: key,
        programLabel: event.programLabel,
        programFamilyKey: event.programFamilyKey,
        year: event.year,
        startMs: event.timestampMs,
        lastMs: event.timestampMs,
        completed: event.feedbackType === 'assessment' || event.completionStatus === 'completed',
        events: [event],
      });
      continue;
    }

    existing.startMs = Math.min(existing.startMs, event.timestampMs);
    existing.lastMs = Math.max(existing.lastMs, event.timestampMs);
    existing.completed = existing.completed || event.feedbackType === 'assessment' || event.completionStatus === 'completed';
    existing.events.push(event);
  }

  const groupList = [...groups.values()];

  const programs: ProgressProgram[] = groupList.map((group) => {
    const yearRank = parseYearRank(group.year);
    const movedOn = !group.completed && groupList.some((candidate) => {
      if (candidate.subject !== group.subject) return false;
      if (candidate.programFamilyKey !== group.programFamilyKey) return false;
      if (candidate.programKey === group.programKey) return false;
      const candidateRank = parseYearRank(candidate.year);
      if (yearRank === null || candidateRank === null) return false;
      return candidateRank > yearRank && candidate.startMs > group.startMs;
    });

    const status: ProgressProgramStatus = group.completed
      ? 'completed'
      : movedOn
        ? 'moved_on_without_assessment'
        : 'in_progress';

    return {
      id: group.programKey,
      title: group.programLabel,
      year: group.year,
      subject: group.subject,
      status,
      startedAt: new Date(group.startMs).toISOString(),
      lastActivityAt: new Date(group.lastMs).toISOString(),
      eventCount: group.events.length,
      events: group.events.slice().sort(compareProgramEvents).map(buildProgramEvent),
    };
  });

  const subjectOrder = ['english', 'maths'];
  const programsBySubject = new Map<string, ProgressProgram[]>();
  for (const program of programs) {
    const key = normalizeSpace(program.subject) || 'Other';
    const list = programsBySubject.get(key) || [];
    list.push(program);
    programsBySubject.set(key, list);
  }

  const subjects: ProgressSubjectSection[] = [...programsBySubject.entries()]
    .sort((a, b) => {
      const aIndex = subjectOrder.indexOf(normalizeLower(a[0]));
      const bIndex = subjectOrder.indexOf(normalizeLower(b[0]));
      const safeA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
      const safeB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
      if (safeA !== safeB) return safeA - safeB;
      return a[0].localeCompare(b[0]);
    })
    .map(([subject, subjectPrograms]) => ({
      key: slugify(subject),
      label: subject,
      programs: subjectPrograms.slice().sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
    }));

  const fallbackStudentName = normalizeSpace(target.studentName || '') || filtered[0]?.studentName || '';
  const fallbackStudentId = normalizeSpace(target.studentId || '');
  const fallbackParentEmail = normalizeSpace(target.parentEmail || '') || filtered[0]?.parentEmail || '';

  return {
    student: {
      studentId: fallbackStudentId,
      studentName: fallbackStudentName,
      parentEmail: fallbackParentEmail,
    },
    subjects,
    totalPrograms: programs.length,
    totalEvents: filtered.length,
  };
}
