import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuthStatus } from '../../lib/auth';
import {
  appendCacheBust,
  buildStudentProgress,
  normalizeProgressRows,
  normalizeSpace,
  parseProgressText,
  resolveGoogleSheetsCsvUrl,
} from '../../lib/progress';
import { loadFeedbackLogRows } from '../../lib/logs';

function isProbablyHttpUrl(value: string) {
  return /^https?:\/\//i.test(normalizeSpace(value));
}

function dereferenceEnvValue(value: string): { value: string; dereferencedFrom?: string } {
  const trimmed = normalizeSpace(value);
  if (!trimmed) return { value: '' };

  // Vercel users sometimes enter an env var name instead of its URL, e.g.
  // FEEDBACK_PROGRESS_CSV_URL=FEEDBACK_LOG_WEBHOOK_URL. Support that safely.
  if (!isProbablyHttpUrl(trimmed) && /^[A-Z0-9_]+$/.test(trimmed)) {
    const referenced = normalizeSpace(process.env[trimmed] || '');
    if (referenced) return { value: referenced, dereferencedFrom: trimmed };
  }

  return { value: trimmed };
}

function resolveProgressSource() {
  const candidates: Array<{ key: string; value: string }> = [
    { key: 'FEEDBACK_PROGRESS_CSV_URL', value: process.env.FEEDBACK_PROGRESS_CSV_URL || '' },
    { key: 'NEXT_PUBLIC_FEEDBACK_PROGRESS_CSV_URL', value: process.env.NEXT_PUBLIC_FEEDBACK_PROGRESS_CSV_URL || '' },
    { key: 'FEEDBACK_LOG_CSV_URL', value: process.env.FEEDBACK_LOG_CSV_URL || '' },
    { key: 'SENTMSGS_CSV_URL', value: process.env.SENTMSGS_CSV_URL || '' },
    { key: 'NEXT_PUBLIC_SENTMSGS_CSV_URL', value: process.env.NEXT_PUBLIC_SENTMSGS_CSV_URL || '' },
  ];

  // Last-resort fallback: some Apps Script logging webhooks also implement GET.
  // If it is POST-only, the API will return a clear message after fetching it.
  candidates.push({ key: 'FEEDBACK_LOG_WEBHOOK_URL', value: process.env.FEEDBACK_LOG_WEBHOOK_URL || '' });

  const configured = candidates.find((candidate) => normalizeSpace(candidate.value));
  if (!configured) {
    return {
      ok: false as const,
      error:
        'Student Progress needs a read URL. Set FEEDBACK_PROGRESS_CSV_URL to the published CSV/Google Sheet URL for the "sentmsgs new" tab.',
    };
  }

  const resolved = dereferenceEnvValue(configured.value);
  if (!resolved.value || !isProbablyHttpUrl(resolved.value)) {
    const suffix = resolved.dereferencedFrom
      ? ` The referenced ${resolved.dereferencedFrom} value is missing or is not a URL.`
      : '';
    return {
      ok: false as const,
      error:
        `${configured.key} is set to "${normalizeSpace(configured.value)}", but Student Progress needs an actual URL.${suffix} ` +
        'Use the published CSV/Google Sheet URL for the "sentmsgs new" tab, not just the name of another environment variable.',
    };
  }

  const preferredSheetName = process.env.FEEDBACK_PROGRESS_SHEET_NAME || 'sentmsgs new';
  const csvUrl = resolveGoogleSheetsCsvUrl(resolved.value, preferredSheetName) || appendCacheBust(resolved.value);
  return {
    ok: true as const,
    key: configured.key,
    dereferencedFrom: resolved.dereferencedFrom,
    url: csvUrl,
    sourceWasWebhook: configured.key === 'FEEDBACK_LOG_WEBHOOK_URL' || resolved.dereferencedFrom === 'FEEDBACK_LOG_WEBHOOK_URL',
  };
}

function dataLooksLikeProgressSheet(fields: string[]) {
  const normalized = fields.map((field) => normalizeSpace(field).toLowerCase());
  return ['timestamp', 'studentname', 'subject', 'strand', 'lesson', 'topic'].some((field) => normalized.includes(field));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const auth = await getAuthStatus(req);
  if (!auth.authed) return res.status(401).json({ ok:false, error:'Login required' });

  const studentId = normalizeSpace(String(req.query.studentId || ''));
  const studentName = normalizeSpace(String(req.query.studentName || ''));
  const parentEmail = normalizeSpace(String(req.query.parentEmail || ''));

  if (!studentId && !studentName) {
    return res.status(400).json({ ok: false, error: 'Missing student identifier' });
  }

  try {
    const privateOrCsv = await loadFeedbackLogRows();
    if (privateOrCsv.configured) {
      if ((privateOrCsv as any).warning && !(privateOrCsv.rows || []).length) {
        return res.status(500).json({ ok: false, error: `Student Progress could not load the feedback log: ${(privateOrCsv as any).warning}` });
      }
      const events = normalizeProgressRows(privateOrCsv.rows || []);
      const progress = buildStudentProgress(events, { studentId, studentName, parentEmail });
      return res.status(200).json({
        ok: true,
        progress,
        source: {
          sourceKey: privateOrCsv.source || 'private-sheet',
          rowCount: (privateOrCsv.rows || []).length,
          eventCount: events.length,
          looksLikePrintLog: false,
        },
      });
    }

    const source = resolveProgressSource();
    if (!source.ok) {
      return res.status(500).json({ ok: false, error: source.error });
    }

    const response = await fetch(source.url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `Failed to load progress data from ${source.key} (${response.status}).`,
      });
    }

    const text = await response.text();
    const parsed = parseProgressText(text);

    if (parsed.looksLikePrintLog) {
      return res.status(500).json({
        ok: false,
        error: 'The progress data source is pointing at a print log sheet instead of the feedback sheet.',
      });
    }

    if (!parsed.rows.length || !dataLooksLikeProgressSheet(parsed.fields)) {
      const hint = source.sourceWasWebhook
        ? ' FEEDBACK_LOG_WEBHOOK_URL is a logging endpoint; it can only be used here if its GET response returns the sentmsgs new rows as CSV or JSON.'
        : '';
      return res.status(500).json({
        ok: false,
        error:
          `Student Progress could reach ${source.key}, but it did not return the "sentmsgs new" progress rows.${hint}`,
      });
    }

    const events = normalizeProgressRows(parsed.rows);
    const progress = buildStudentProgress(events, { studentId, studentName, parentEmail });

    return res.status(200).json({
      ok: true,
      progress,
      source: {
        sourceKey: source.key,
        dereferencedFrom: source.dereferencedFrom || '',
        rowCount: parsed.rows.length,
        eventCount: events.length,
        looksLikePrintLog: parsed.looksLikePrintLog,
      },
    });
  } catch (error: any) {
    console.error('student-progress error', error);
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to build student progress.',
    });
  }
}
