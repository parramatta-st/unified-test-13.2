import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../lib/adminAuth';
import { getActiveTutors, type TutorConfig } from '../../../lib/tutorConfig';
import {
  TimeClockError,
  buildPayrollRange,
  loadTimeClockState,
  newTimeClockId,
  publicTimeClockConfig,
  recordTimeClockMutation,
  requestFingerprint,
  statusForOutcome,
  timeClockConfigured,
  tutorIdFor,
} from '../../../lib/timeClock';
import {
  addCalendarDays,
  durationHours,
  parseSydneyDateTime,
  rangeFromSydneyDateKeys,
  sydneyDateKey,
} from '../../../lib/timeClockCore';

function norm(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return norm(value).toLowerCase();
}

function cleanText(value: unknown, label: string, maximum: number) {
  const text = norm(value);
  if (text.length > maximum) {
    throw new TimeClockError(
      400,
      'TEXT_TOO_LONG',
      `${label} must be ${maximum} characters or fewer.`,
    );
  }
  return text;
}

function exactTutor(tutors: TutorConfig[], tutorName: string) {
  return tutors.find((tutor) => lower(tutor.tutorName) === lower(tutorName)) || null;
}

function parseAdminTime(value: unknown, label: string, required: boolean) {
  const text = norm(value);
  if (!text && !required) return null;
  const result = parseSydneyDateTime(text);
  if (result.ok === false) {
    throw new TimeClockError(422, result.code, `${label}: ${result.error}`, {
      field: label === 'Clock in' ? 'clockIn' : 'clockOut',
      candidates: result.candidates || [],
    });
  }
  return result;
}

function validateAdminTimes(
  clockIn: { ms: number; iso: string },
  clockOut: { ms: number; iso: string } | null,
) {
  const now = Date.now();
  if (clockIn.ms > now + 5 * 60_000 || (clockOut && clockOut.ms > now + 5 * 60_000)) {
    throw new TimeClockError(
      422,
      'FUTURE_SHIFT',
      'Clock times cannot be more than five minutes in the future.',
    );
  }
  if (clockOut && clockOut.ms <= clockIn.ms) {
    throw new TimeClockError(
      422,
      'INVALID_CLOCK_ORDER',
      'Clock out must be after clock in.',
    );
  }
  if (clockOut && durationHours(clockIn.ms, clockOut.ms) > 168) {
    throw new TimeClockError(
      422,
      'SHIFT_TOO_LONG',
      'A single shift cannot exceed seven days. Check the dates and try again.',
    );
  }
}

function sendError(res: NextApiResponse, error: unknown) {
  if (error instanceof TimeClockError) {
    return res.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      ...(error.details || {}),
    });
  }
  const message = error instanceof Error ? error.message : 'Could not load Time Clock admin.';
  return res.status(500).json({ ok: false, code: 'TIME_CLOCK_ERROR', error: message });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const admin = await requireAdmin(req);
  if (!admin.authed) {
    return res.status(401).json({
      ok: false,
      code: 'AUTH_REQUIRED',
      error: 'Please sign in again.',
    });
  }
  if (!admin.isAdmin) {
    return res.status(403).json({
      ok: false,
      code: 'ADMIN_REQUIRED',
      error: 'Admin access required.',
    });
  }

  if (req.method === 'GET') {
    try {
      const today = sydneyDateKey(Date.now());
      const from = norm(req.query.from) || addCalendarDays(today, -13);
      const to = norm(req.query.to) || today;
      const range = rangeFromSydneyDateKeys(from, to);
      if (!range.ok) {
        throw new TimeClockError(400, 'INVALID_DATE_RANGE', range.error);
      }
      const tutors = await getActiveTutors(admin.campus);
      const config = publicTimeClockConfig();
      if (!config.sheets) {
        return res.status(200).json({
          ok: true,
          config,
          range: { from: range.from, to: range.to, calendarDays: range.calendarDays },
          rows: [],
          summary: [],
          adjustments: [],
          integrityWarnings: [],
          tutors: tutors.map((tutor) => tutor.tutorName),
        });
      }
      const state = await loadTimeClockState();
      const view = buildPayrollRange({
        state,
        campusKey: admin.campus,
        startMs: range.startMs,
        endMs: range.endMs,
      });
      return res.status(200).json({
        ok: true,
        config,
        range: { from: range.from, to: range.to, calendarDays: range.calendarDays },
        rows: view.rows,
        summary: view.summary,
        adjustments: view.adjustments,
        integrityWarnings: state.integrityWarnings,
        tutors: tutors.map((tutor) => tutor.tutorName),
      });
    } catch (error) {
      return sendError(res, error);
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Method not allowed.',
    });
  }

  try {
    if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) {
      throw new TimeClockError(
        415,
        'JSON_REQUIRED',
        'Time Clock actions must be sent as JSON.',
      );
    }
    if (!timeClockConfigured().sheets) {
      throw new TimeClockError(
        503,
        'STORAGE_NOT_CONFIGURED',
        'Time Clock Google Sheets storage is not configured yet.',
      );
    }
    const action = lower(req.body?.action);
    if (!['create_shift', 'edit_shift', 'void_shift'].includes(action)) {
      throw new TimeClockError(400, 'UNKNOWN_ACTION', 'Unknown admin action.');
    }
    const reason = cleanText(req.body?.reason, 'Reason', 1_000);
    if (reason.length < 8) {
      throw new TimeClockError(
        400,
        'REASON_REQUIRED',
        'Enter a clear reason of at least 8 characters for every admin change.',
      );
    }
    const notes = cleanText(req.body?.notes, 'Notes', 1_000);
    const requestId = norm(req.body?.requestId);
    const shiftId = norm(req.body?.shiftId);
    const requestedVersion = Number(req.body?.version);

    let target:
      | (TutorConfig & { tutorId: string })
      | null = null;
    let parsedClockIn: ReturnType<typeof parseAdminTime> = null;
    let parsedClockOut: ReturnType<typeof parseAdminTime> = null;
    if (action === 'create_shift') {
      const tutors = await getActiveTutors(admin.campus);
      const found = exactTutor(tutors, cleanText(req.body?.tutorName, 'Tutor name', 120));
      if (!found) {
        throw new TimeClockError(
          404,
          'TUTOR_NOT_ACTIVE',
          'Choose an active tutor from this campus.',
        );
      }
      target = {
        ...found,
        tutorId: tutorIdFor(found.campusKey, found.tutorName, found.email),
      };
      parsedClockIn = parseAdminTime(req.body?.clockIn, 'Clock in', true);
      parsedClockOut = parseAdminTime(req.body?.clockOut, 'Clock out', false);
      validateAdminTimes(parsedClockIn!, parsedClockOut);
    } else if (!shiftId) {
      throw new TimeClockError(400, 'SHIFT_REQUIRED', 'Shift ID is required.');
    } else if (!Number.isInteger(requestedVersion) || requestedVersion < 1) {
      throw new TimeClockError(
        400,
        'SHIFT_VERSION_REQUIRED',
        'Refresh the page and try again with the current shift version.',
      );
    } else if (action === 'edit_shift') {
      parsedClockIn = parseAdminTime(req.body?.clockIn, 'Clock in', true);
      parsedClockOut = parseAdminTime(req.body?.clockOut, 'Clock out', false);
      validateAdminTimes(parsedClockIn!, parsedClockOut);
    }

    const fingerprint = requestFingerprint({
      action,
      campusKey: lower(admin.campus),
      tutorId: target?.tutorId || '',
      shiftId,
      version: Number.isFinite(requestedVersion) ? requestedVersion : '',
      clockIn: parsedClockIn?.iso || '',
      clockOut: parsedClockOut?.iso || '',
      reason,
      notes,
    });
    const result = await recordTimeClockMutation({
      campusKey: admin.campus,
      actorName: admin.tutor,
      actorRole: 'admin',
      requestId,
      fingerprint,
      buildEvent: (state) => {
        const occurredAt = new Date().toISOString();
        if (action === 'create_shift') {
          return {
            tutorId: target!.tutorId,
            tutorName: target!.tutorName,
            action: 'admin_create',
            occurredAt,
            targetShiftId: newTimeClockId('shift'),
            baseVersion: '',
            clockIn: parsedClockIn!.iso,
            clockOut: parsedClockOut?.iso || '',
            notes,
            adminOverride: 'TRUE',
            overrideReason: reason,
            reason,
          };
        }
        const current = state.shifts.find(
          (shift) =>
            shift.shiftId === shiftId &&
            lower(shift.campusKey) === lower(admin.campus),
        );
        if (!current) {
          throw new TimeClockError(404, 'SHIFT_NOT_FOUND', 'Shift not found.');
        }
        return {
          tutorId: current.tutorId,
          tutorName: current.tutorName,
          action: action === 'edit_shift' ? 'admin_edit' : 'admin_void',
          occurredAt,
          targetShiftId: current.shiftId,
          baseVersion: String(requestedVersion),
          clockIn: action === 'edit_shift' ? parsedClockIn!.iso : '',
          clockOut: action === 'edit_shift' ? parsedClockOut?.iso || '' : '',
          notes,
          adminOverride: 'TRUE',
          overrideReason: reason,
          reason,
        };
      },
    });
    const outcome = result.outcome;
    const shift = outcome.shiftId
      ? result.state.shifts.find((candidate) => candidate.shiftId === outcome.shiftId) || null
      : null;
    if (!outcome.accepted) {
      return res.status(statusForOutcome(outcome)).json({
        ok: false,
        code: outcome.code,
        error: outcome.error || 'The admin change was not accepted.',
        shift,
      });
    }
    const messages: Record<string, string> = {
      create_shift: 'Manual shift created and added to the audit history.',
      edit_shift: 'Shift corrected and adjustment history saved.',
      void_shift: 'Shift voided without deleting its history.',
    };
    return res.status(200).json({
      ok: true,
      code: outcome.code,
      replayed: !!outcome.replayed,
      message: messages[action],
      shift,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
