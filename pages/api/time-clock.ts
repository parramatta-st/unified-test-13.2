import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../lib/adminAuth';
import { getActiveTutors, type TutorConfig } from '../../lib/tutorConfig';
import {
  TimeClockError,
  findActiveShift,
  loadTimeClockState,
  newTimeClockId,
  publicShiftSnapshot,
  publicTimeClockConfig,
  recordTimeClockMutation,
  requestFingerprint,
  statusForOutcome,
  timeClockConfigured,
  tutorIdFor,
  verifyLocation,
  type LocationInput,
} from '../../lib/timeClock';
import { hasWrittenOverrideReason } from '../../lib/timeClockValidation';

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

function browserLocation(value: any): LocationInput | null {
  if (!value || typeof value !== 'object') return null;
  return {
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    accuracy: Number(value.accuracy),
  };
}

function exactTutor(tutors: TutorConfig[], requestedName: string) {
  return (
    tutors.find((tutor) => lower(tutor.tutorName) === lower(requestedName)) ||
    null
  );
}

async function resolveTarget(options: {
  campusKey: string;
  actorName: string;
  isAdmin: boolean;
  requestedName: string;
}) {
  if (
    !options.isAdmin &&
    options.requestedName &&
    lower(options.requestedName) !== lower(options.actorName)
  ) {
    throw new TimeClockError(
      403,
      'TARGET_FORBIDDEN',
      'Only admins can clock another team member in or out.',
    );
  }
  const activeTutors = await getActiveTutors(options.campusKey);
  const requested = options.isAdmin
    ? options.requestedName || options.actorName
    : options.actorName;
  const target = exactTutor(activeTutors, requested);
  if (!target) {
    throw new TimeClockError(
      404,
      'TUTOR_NOT_ACTIVE',
      'That tutor is not in the active tutor list for this campus.',
    );
  }
  return {
    ...target,
    tutorId: tutorIdFor(target.campusKey, target.tutorName, target.email),
  };
}

function locationStatus(status: ReturnType<typeof verifyLocation>) {
  if (status.code === 'GEOFENCE_NOT_CONFIGURED') return 503;
  if (status.code === 'OUTSIDE_GEOFENCE') return 403;
  return 422;
}

function sendError(res: NextApiResponse, error: unknown) {
  if (error instanceof TimeClockError) {
    console.warn('[time-clock] request rejected', {
      status: error.status,
      code: error.code,
    });
    return res.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
      ...(error.details || {}),
    });
  }
  const message = error instanceof Error ? error.message : 'Time Clock request failed.';
  console.error('[time-clock] unexpected request failure', {
    name: error instanceof Error ? error.name : 'UnknownError',
  });
  return res.status(500).json({ ok: false, code: 'TIME_CLOCK_ERROR', error: message });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const auth = await requireAdmin(req);
  if (!auth.authed) {
    return res.status(401).json({
      ok: false,
      code: 'AUTH_REQUIRED',
      error: 'Please sign in again.',
    });
  }

  if (req.method === 'GET') {
    try {
      const tutors = await getActiveTutors(auth.campus);
      const self = exactTutor(tutors, auth.tutor);
      const config = publicTimeClockConfig();
      if (!config.sheets) {
        return res.status(200).json({
          ok: true,
          tutor: auth.tutor,
          campus: auth.campus,
          isAdmin: auth.isAdmin,
          activeShift: null,
          activeShifts: [],
          recentShifts: [],
          config,
          tutors: auth.isAdmin ? tutors.map((tutor) => tutor.tutorName) : [],
        });
      }
      if (!self) {
        throw new TimeClockError(
          403,
          'TUTOR_NOT_ACTIVE',
          'Your tutor account is no longer active for this campus.',
        );
      }
      const selfId = tutorIdFor(self.campusKey, self.tutorName, self.email);
      const state = await loadTimeClockState();
      const current = findActiveShift(
        state.shifts,
        auth.campus,
        selfId,
        self.tutorName,
      );
      const campusShifts = state.shifts.filter(
        (shift) => lower(shift.campusKey) === lower(auth.campus),
      );
      const recentShifts = campusShifts
        .filter((shift) => shift.tutorId === selfId)
        .sort((a, b) => Date.parse(b.clockIn) - Date.parse(a.clockIn))
        .slice(0, 5)
        .map(publicShiftSnapshot);
      return res.status(200).json({
        ok: true,
        tutor: self.tutorName,
        tutorId: selfId,
        campus: auth.campus,
        isAdmin: auth.isAdmin,
        activeShift: publicShiftSnapshot(current),
        activeShifts: auth.isAdmin
          ? campusShifts
              .filter((shift) => shift.status === 'active' && !shift.clockOut)
              .map(publicShiftSnapshot)
          : [],
        recentShifts,
        integrityWarningCount: auth.isAdmin ? state.integrityWarnings.length : 0,
        config,
        tutors: auth.isAdmin ? tutors.map((tutor) => tutor.tutorName) : [],
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
    const config = timeClockConfigured();
    if (!config.sheets) {
      throw new TimeClockError(
        503,
        'STORAGE_NOT_CONFIGURED',
        'Time Clock Google Sheets storage is not configured yet.',
      );
    }
    const action = lower(req.body?.action);
    if (action !== 'clock_in' && action !== 'clock_out') {
      throw new TimeClockError(
        400,
        'UNKNOWN_ACTION',
        'Choose Clock In or Clock Out.',
      );
    }
    const target = await resolveTarget({
      campusKey: auth.campus,
      actorName: auth.tutor,
      isAdmin: auth.isAdmin,
      requestedName: cleanText(req.body?.tutorName, 'Tutor name', 120),
    });
    const requestId = norm(req.body?.requestId);
    const notes = cleanText(req.body?.notes, 'Notes', 1_000);
    const adminOverride = req.body?.adminOverride === true;
    const overrideReason = cleanText(
      req.body?.overrideReason,
      'Override reason',
      500,
    );
    if (adminOverride && !auth.isAdmin) {
      throw new TimeClockError(
        403,
        'ADMIN_OVERRIDE_FORBIDDEN',
        'Only admins can override the location requirement.',
      );
    }
    if (adminOverride && !hasWrittenOverrideReason(overrideReason)) {
      throw new TimeClockError(
        400,
        'OVERRIDE_REASON_REQUIRED',
        'Enter a written reason for the admin location override.',
      );
    }

    let location = browserLocation(req.body?.location);
    const check = verifyLocation(location);
    if (!adminOverride && !check.ok) {
      throw new TimeClockError(locationStatus(check), check.code, check.error, {
        location: {
          code: check.code,
          distanceM: check.distanceM,
          radiusM: check.radiusM,
          accuracy: check.accuracy,
        },
      });
    }
    if (adminOverride && check.code === 'INVALID_LOCATION') location = null;

    const fingerprint = requestFingerprint({
      action,
      campusKey: lower(auth.campus),
      tutorId: target.tutorId,
      notes,
      adminOverride,
      overrideReason,
    });
    const result = await recordTimeClockMutation({
      campusKey: auth.campus,
      actorName: auth.tutor,
      actorRole: auth.isAdmin ? 'admin' : 'tutor',
      requestId,
      fingerprint,
      buildEvent: (state) => {
        const current = findActiveShift(
          state.shifts,
          auth.campus,
          target.tutorId,
          target.tutorName,
        );
        return {
          tutorId: target.tutorId,
          tutorName: target.tutorName,
          action,
          occurredAt: new Date().toISOString(),
          targetShiftId:
            action === 'clock_in'
              ? newTimeClockId('shift')
              : current?.shiftId || newTimeClockId('missing'),
          baseVersion: action === 'clock_out' && current ? String(current.version) : '',
          notes,
          latitude: location ? String(location.latitude) : '',
          longitude: location ? String(location.longitude) : '',
          accuracy: location ? String(location.accuracy) : '',
          distanceM:
            check.distanceM === null ? '' : String(Math.round(check.distanceM * 100) / 100),
          locationVerified: check.ok ? 'TRUE' : 'FALSE',
          adminOverride: adminOverride ? 'TRUE' : 'FALSE',
          overrideReason: adminOverride ? overrideReason : '',
          reason: '',
        };
      },
    });
    const outcome = result.outcome;
    const shift = outcome.shiftId
      ? result.state.shifts.find((candidate) => candidate.shiftId === outcome.shiftId) || null
      : null;
    if (!outcome.accepted) {
      console.warn('[time-clock] event rejected', {
        status: statusForOutcome(outcome),
        code: outcome.code,
      });
      return res.status(statusForOutcome(outcome)).json({
        ok: false,
        code: outcome.code,
        error: outcome.error || 'The Time Clock action was not accepted.',
        activeShift: publicShiftSnapshot(
          findActiveShift(
            result.state.shifts,
            auth.campus,
            target.tutorId,
            target.tutorName,
          ),
        ),
      });
    }
    return res.status(200).json({
      ok: true,
      code: outcome.code,
      replayed: !!outcome.replayed,
      message:
        action === 'clock_in'
          ? `${target.tutorName} clocked in successfully.`
          : `${target.tutorName} clocked out successfully.`,
      shift: publicShiftSnapshot(shift),
      location: {
        verified: check.ok,
        overridden: adminOverride,
        distanceM: check.distanceM,
        radiusM: check.radiusM,
        accuracy: check.accuracy,
      },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
