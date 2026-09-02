import crypto from 'crypto';
import {
  appendSheetRows,
  ensureSheetHeaders,
  googleSheetsCredentialsConfigured,
  overwriteSheetRows,
  readSheetRows,
  spreadsheetIdFor,
  type SheetRow,
} from './googleSheets';
import {
  clipInterval,
  durationHours,
  intervalsOverlap,
  splitPaidHours,
  type PaidHours,
} from './timeClockCore';

export const TIME_CLOCK_TZ = 'Australia/Sydney';

export const EVENT_HEADERS = [
  'eventId',
  'requestId',
  'requestFingerprint',
  'schemaVersion',
  'campusKey',
  'tutorId',
  'tutorName',
  'action',
  'occurredAt',
  'actorName',
  'actorRole',
  'targetShiftId',
  'baseVersion',
  'clockIn',
  'clockOut',
  'notes',
  'latitude',
  'longitude',
  'accuracy',
  'distanceM',
  'locationVerified',
  'adminOverride',
  'overrideReason',
  'reason',
  'eventHash',
] as const;

export const SHIFT_HEADERS = [
  'shiftId',
  'campusKey',
  'tutorId',
  'tutorName',
  'clockIn',
  'clockOut',
  'normalMinutes',
  'after7Minutes',
  'saturdayMinutes',
  'unclassifiedMinutes',
  'elapsedMinutes',
  'normalHours',
  'after7Hours',
  'saturdayHours',
  'unclassifiedHours',
  'elapsedHours',
  'status',
  'clockInLat',
  'clockInLng',
  'clockInAccuracy',
  'clockInDistanceM',
  'clockInLocationVerified',
  'clockOutLat',
  'clockOutLng',
  'clockOutAccuracy',
  'clockOutDistanceM',
  'clockOutLocationVerified',
  'clockInBy',
  'clockOutBy',
  'clockInPerformedAs',
  'clockOutPerformedAs',
  'clockInNotes',
  'clockOutNotes',
  'clockInAdminOverride',
  'clockOutAdminOverride',
  'clockInOverrideReason',
  'clockOutOverrideReason',
  'clockInRequestId',
  'clockOutRequestId',
  'createdAt',
  'updatedAt',
  'edited',
  'editCount',
  'version',
  'manual',
  'voidedAt',
  'voidedBy',
  'voidReason',
  'reviewFlags',
  'lastEventId',
] as const;

export const ADJUSTMENT_HEADERS = [
  'adjustmentId',
  'eventId',
  'shiftId',
  'action',
  'campusKey',
  'tutorId',
  'tutorName',
  'changedAt',
  'changedBy',
  'changedByRole',
  'reason',
  'oldClockIn',
  'newClockIn',
  'oldClockOut',
  'newClockOut',
  'oldStatus',
  'newStatus',
  'oldNormalMinutes',
  'newNormalMinutes',
  'oldAfter7Minutes',
  'newAfter7Minutes',
  'oldSaturdayMinutes',
  'newSaturdayMinutes',
  'oldUnclassifiedMinutes',
  'newUnclassifiedMinutes',
  'oldNormalHours',
  'newNormalHours',
  'oldAfter7Hours',
  'newAfter7Hours',
  'oldSaturdayHours',
  'newSaturdayHours',
  'oldUnclassifiedHours',
  'newUnclassifiedHours',
] as const;

export type TimeClockAction =
  | 'clock_in'
  | 'clock_out'
  | 'admin_create'
  | 'admin_edit'
  | 'admin_void';

export type ClockEvent = Record<(typeof EVENT_HEADERS)[number], string> & {
  sequence?: number;
};

export type TimeClockShift = {
  shiftId: string;
  campusKey: string;
  tutorId: string;
  tutorName: string;
  clockIn: string;
  clockOut: string;
  normalMinutes: number;
  after7Minutes: number;
  saturdayMinutes: number;
  unclassifiedMinutes: number;
  elapsedMinutes: number;
  normalHours: number;
  after7Hours: number;
  saturdayHours: number;
  unclassifiedHours: number;
  elapsedHours: number;
  status: 'active' | 'completed' | 'voided';
  clockInLat: string;
  clockInLng: string;
  clockInAccuracy: string;
  clockInDistanceM: string;
  clockInLocationVerified: boolean;
  clockOutLat: string;
  clockOutLng: string;
  clockOutAccuracy: string;
  clockOutDistanceM: string;
  clockOutLocationVerified: boolean;
  clockInBy: string;
  clockOutBy: string;
  clockInPerformedAs: 'admin' | 'tutor';
  clockOutPerformedAs: 'admin' | 'tutor' | '';
  clockInNotes: string;
  clockOutNotes: string;
  clockInAdminOverride: boolean;
  clockOutAdminOverride: boolean;
  clockInOverrideReason: string;
  clockOutOverrideReason: string;
  clockInRequestId: string;
  clockOutRequestId: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  editCount: number;
  version: number;
  manual: boolean;
  voidedAt: string;
  voidedBy: string;
  voidReason: string;
  reviewFlags: string[];
  lastEventId: string;
};

export type TimeClockAdjustment = {
  adjustmentId: string;
  eventId: string;
  shiftId: string;
  action: 'created' | 'edited' | 'voided';
  campusKey: string;
  tutorId: string;
  tutorName: string;
  changedAt: string;
  changedBy: string;
  changedByRole: 'admin';
  reason: string;
  oldClockIn: string;
  newClockIn: string;
  oldClockOut: string;
  newClockOut: string;
  oldStatus: string;
  newStatus: string;
  oldNormalMinutes: number | '';
  newNormalMinutes: number | '';
  oldAfter7Minutes: number | '';
  newAfter7Minutes: number | '';
  oldSaturdayMinutes: number | '';
  newSaturdayMinutes: number | '';
  oldUnclassifiedMinutes: number | '';
  newUnclassifiedMinutes: number | '';
  oldNormalHours: number | '';
  newNormalHours: number | '';
  oldAfter7Hours: number | '';
  newAfter7Hours: number | '';
  oldSaturdayHours: number | '';
  newSaturdayHours: number | '';
  oldUnclassifiedHours: number | '';
  newUnclassifiedHours: number | '';
};

export type EventOutcome = {
  accepted: boolean;
  replayed?: boolean;
  code: string;
  error?: string;
  shiftId?: string;
  originalEventId?: string;
};

export type ReplayResult = {
  events: ClockEvent[];
  shifts: TimeClockShift[];
  adjustments: TimeClockAdjustment[];
  outcomes: Map<string, EventOutcome>;
  requestEvents: Map<string, ClockEvent>;
  requestOutcomes: Map<string, EventOutcome>;
  integrityWarnings: string[];
};

export type LocationInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type LocationResult = {
  ok: boolean;
  configured: boolean;
  code: string;
  error: string;
  distanceM: number | null;
  radiusM: number;
  accuracy: number | null;
};

function norm(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return norm(value).toLowerCase();
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function truthy(value: unknown) {
  return ['true', '1', 'yes', 'y'].includes(lower(value));
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

export function timeClockSheetNames() {
  return {
    events: norm(process.env.TIME_CLOCK_EVENTS_SHEET_NAME) || 'time_clock_events',
    shifts: norm(process.env.TIME_CLOCK_SHIFTS_SHEET_NAME) || 'time_clock_shifts',
    adjustments:
      norm(process.env.TIME_CLOCK_ADJUSTMENTS_SHEET_NAME) ||
      'time_clock_adjustments',
  };
}

export function timeClockSpreadsheetId() {
  return spreadsheetIdFor('TIME_CLOCK');
}

export function timeClockConfigured() {
  const rawLatitude = norm(process.env.TIME_CLOCK_LATITUDE);
  const rawLongitude = norm(process.env.TIME_CLOCK_LONGITUDE);
  const latitude = rawLatitude ? Number(rawLatitude) : Number.NaN;
  const longitude = rawLongitude ? Number(rawLongitude) : Number.NaN;
  const coordinatesValid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
  const coordinatesPresent = !!(rawLatitude || rawLongitude);
  const spreadsheetId = timeClockSpreadsheetId();
  const credentials = googleSheetsCredentialsConfigured();
  return {
    sheets: credentials && !!spreadsheetId,
    credentials,
    hasSpreadsheetId: !!spreadsheetId,
    geofence: coordinatesValid,
    geofenceError: coordinatesValid
      ? ''
      : coordinatesPresent
        ? 'The configured centre latitude or longitude is invalid.'
        : 'The centre latitude and longitude have not been configured.',
    latitude: coordinatesValid ? latitude : null,
    longitude: coordinatesValid ? longitude : null,
    radiusM: boundedNumber(process.env.TIME_CLOCK_RADIUS_METRES, 150, 20, 5_000),
    maxAccuracyM: boundedNumber(
      process.env.TIME_CLOCK_MAX_ACCURACY_METRES,
      200,
      10,
      5_000,
    ),
    longShiftHours: boundedNumber(
      process.env.TIME_CLOCK_LONG_SHIFT_HOURS,
      16,
      4,
      168,
    ),
    openShiftAlertHours: boundedNumber(
      process.env.TIME_CLOCK_OPEN_SHIFT_ALERT_HOURS,
      12,
      2,
      168,
    ),
  };
}

export function publicTimeClockConfig() {
  const config = timeClockConfigured();
  return {
    sheets: config.sheets,
    credentials: config.credentials,
    hasSpreadsheetId: config.hasSpreadsheetId,
    geofence: config.geofence,
    geofenceError: config.geofenceError,
    radiusM: config.radiusM,
    maxAccuracyM: config.maxAccuracyM,
    longShiftHours: config.longShiftHours,
    openShiftAlertHours: config.openShiftAlertHours,
    sheetNames: timeClockSheetNames(),
  };
}

export function distanceMetres(
  firstLatitude: number,
  firstLongitude: number,
  secondLatitude: number,
  secondLongitude: number,
) {
  const earthRadiusM = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(secondLatitude - firstLatitude);
  const longitudeDelta = radians(secondLongitude - firstLongitude);
  const first = Math.sin(latitudeDelta / 2);
  const second = Math.sin(longitudeDelta / 2);
  const haversine =
    first * first +
    Math.cos(radians(firstLatitude)) *
      Math.cos(radians(secondLatitude)) *
      second *
      second;
  return (
    2 *
    earthRadiusM *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function verifyLocation(input?: LocationInput | null): LocationResult {
  const config = timeClockConfigured();
  if (!config.geofence) {
    return {
      ok: false,
      configured: false,
      code: 'GEOFENCE_NOT_CONFIGURED',
      error: config.geofenceError,
      distanceM: null,
      radiusM: config.radiusM,
      accuracy: null,
    };
  }
  if (!input) {
    return {
      ok: false,
      configured: true,
      code: 'LOCATION_REQUIRED',
      error: 'Location permission is required to clock in or out.',
      distanceM: null,
      radiusM: config.radiusM,
      accuracy: null,
    };
  }
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const accuracy = Number(input.accuracy);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 10_000
  ) {
    return {
      ok: false,
      configured: true,
      code: 'INVALID_LOCATION',
      error: 'The browser supplied invalid location information. Please try again.',
      distanceM: null,
      radiusM: config.radiusM,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
    };
  }
  const distanceM = distanceMetres(
    latitude,
    longitude,
    config.latitude!,
    config.longitude!,
  );
  if (accuracy > config.maxAccuracyM) {
    return {
      ok: false,
      configured: true,
      code: 'LOCATION_INACCURATE',
      error: `Your location accuracy is about ${Math.round(accuracy)} m. Move closer to a window or enable precise location, then try again.`,
      distanceM,
      radiusM: config.radiusM,
      accuracy,
    };
  }
  if (distanceM > config.radiusM) {
    return {
      ok: false,
      configured: true,
      code: 'OUTSIDE_GEOFENCE',
      error: `You appear to be ${Math.round(distanceM)} m from the centre. Clocking is allowed within ${Math.round(config.radiusM)} m.`,
      distanceM,
      radiusM: config.radiusM,
      accuracy,
    };
  }
  return {
    ok: true,
    configured: true,
    code: 'LOCATION_VERIFIED',
    error: '',
    distanceM,
    radiusM: config.radiusM,
    accuracy,
  };
}

export function newTimeClockId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function tutorIdFor(campusKey: string, tutorName: string, email = '') {
  const identity = `${lower(campusKey)}\u0000${lower(email) || lower(tutorName)}`;
  return `tutor_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

export function requestFingerprint(value: unknown) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

export function validRequestId(value: unknown) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(norm(value));
}

function requestKey(event: Pick<ClockEvent, 'campusKey' | 'actorName' | 'requestId'>) {
  return `${lower(event.campusKey)}|${lower(event.actorName)}|${event.requestId}`;
}

function hashEvent(event: Partial<ClockEvent>) {
  const values = EVENT_HEADERS.filter((header) => header !== 'eventHash').map(
    (header) => norm(event[header]),
  );
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export function createClockEvent(
  input: Partial<ClockEvent> &
    Pick<
      ClockEvent,
      | 'requestId'
      | 'requestFingerprint'
      | 'campusKey'
      | 'tutorId'
      | 'tutorName'
      | 'action'
      | 'occurredAt'
      | 'actorName'
      | 'actorRole'
      | 'targetShiftId'
    >,
) {
  const event = {} as ClockEvent;
  for (const header of EVENT_HEADERS) event[header] = norm(input[header]);
  event.eventId = event.eventId || newTimeClockId('event');
  event.schemaVersion = '1';
  event.campusKey = lower(event.campusKey);
  event.actorRole = lower(event.actorRole);
  event.locationVerified = truthy(input.locationVerified) ? 'TRUE' : 'FALSE';
  event.adminOverride = truthy(input.adminOverride) ? 'TRUE' : 'FALSE';
  event.eventHash = hashEvent(event);
  return event;
}

function emptyHours(): PaidHours {
  return {
    normalMinutes: 0,
    after7Minutes: 0,
    saturdayMinutes: 0,
    unclassifiedMinutes: 0,
    elapsedMinutes: 0,
    normalHours: 0,
    after7Hours: 0,
    saturdayHours: 0,
    unclassifiedHours: 0,
    elapsedHours: 0,
  };
}

function instant(value: unknown) {
  const milliseconds = Date.parse(norm(value));
  return Number.isFinite(milliseconds) ? milliseconds : Number.NaN;
}

function sameTutor(
  shift: Pick<TimeClockShift, 'campusKey' | 'tutorId' | 'tutorName'>,
  event: Pick<ClockEvent, 'campusKey' | 'tutorId' | 'tutorName'>,
) {
  if (lower(shift.campusKey) !== lower(event.campusKey)) return false;
  if (shift.tutorId && event.tutorId) return shift.tutorId === event.tutorId;
  return lower(shift.tutorName) === lower(event.tutorName);
}

function recalculateShift(shift: TimeClockShift) {
  if (!shift.clockOut) {
    Object.assign(shift, emptyHours());
    shift.status = shift.status === 'voided' ? 'voided' : 'active';
    return shift;
  }
  const startMs = instant(shift.clockIn);
  const endMs = instant(shift.clockOut);
  const paid = splitPaidHours(startMs, endMs);
  shift.normalMinutes = paid.normalMinutes;
  shift.after7Minutes = paid.after7Minutes;
  shift.saturdayMinutes = paid.saturdayMinutes;
  shift.unclassifiedMinutes = paid.unclassifiedMinutes;
  shift.elapsedMinutes = paid.elapsedMinutes;
  shift.normalHours = paid.normalHours;
  shift.after7Hours = paid.after7Hours;
  shift.saturdayHours = paid.saturdayHours;
  shift.unclassifiedHours = paid.unclassifiedHours;
  shift.elapsedHours = paid.elapsedHours;
  if (shift.status !== 'voided') shift.status = 'completed';
  return shift;
}

function shiftInterval(shift: TimeClockShift) {
  const startMs = instant(shift.clockIn);
  const parsedEnd = shift.clockOut ? instant(shift.clockOut) : null;
  return { startMs, endMs: parsedEnd };
}

function overlappingShift(
  shifts: Iterable<TimeClockShift>,
  event: Pick<ClockEvent, 'campusKey' | 'tutorId' | 'tutorName'>,
  startMs: number,
  endMs: number | null,
  excludeShiftId = '',
) {
  for (const shift of shifts) {
    if (shift.shiftId === excludeShiftId || shift.status === 'voided') continue;
    if (!sameTutor(shift, event)) continue;
    const existing = shiftInterval(shift);
    if (
      intervalsOverlap(
        startMs,
        endMs,
        existing.startMs,
        existing.endMs,
      )
    ) {
      return shift;
    }
  }
  return null;
}

function activeShift(
  shifts: Iterable<TimeClockShift>,
  event: Pick<ClockEvent, 'campusKey' | 'tutorId' | 'tutorName'>,
) {
  for (const shift of shifts) {
    if (shift.status === 'active' && !shift.clockOut && sameTutor(shift, event)) {
      return shift;
    }
  }
  return null;
}

function accepted(shiftId: string, code = 'ACCEPTED'): EventOutcome {
  return { accepted: true, code, shiftId };
}

function rejected(code: string, error: string, shiftId = ''): EventOutcome {
  return { accepted: false, code, error, shiftId: shiftId || undefined };
}

function adjustmentFrom(
  event: ClockEvent,
  action: TimeClockAdjustment['action'],
  before: TimeClockShift | null,
  after: TimeClockShift,
): TimeClockAdjustment {
  return {
    adjustmentId: `adjustment_${event.eventId}`,
    eventId: event.eventId,
    shiftId: after.shiftId,
    action,
    campusKey: after.campusKey,
    tutorId: after.tutorId,
    tutorName: after.tutorName,
    changedAt: event.occurredAt,
    changedBy: event.actorName,
    changedByRole: 'admin',
    reason: event.reason,
    oldClockIn: before?.clockIn || '',
    newClockIn: after.clockIn,
    oldClockOut: before?.clockOut || '',
    newClockOut: after.clockOut,
    oldStatus: before?.status || '',
    newStatus: after.status,
    oldNormalMinutes: before?.normalMinutes ?? '',
    newNormalMinutes: after.normalMinutes,
    oldAfter7Minutes: before?.after7Minutes ?? '',
    newAfter7Minutes: after.after7Minutes,
    oldSaturdayMinutes: before?.saturdayMinutes ?? '',
    newSaturdayMinutes: after.saturdayMinutes,
    oldUnclassifiedMinutes: before?.unclassifiedMinutes ?? '',
    newUnclassifiedMinutes: after.unclassifiedMinutes,
    oldNormalHours: before?.normalHours ?? '',
    newNormalHours: after.normalHours,
    oldAfter7Hours: before?.after7Hours ?? '',
    newAfter7Hours: after.after7Hours,
    oldSaturdayHours: before?.saturdayHours ?? '',
    newSaturdayHours: after.saturdayHours,
    oldUnclassifiedHours: before?.unclassifiedHours ?? '',
    newUnclassifiedHours: after.unclassifiedHours,
  };
}

function cloneShift(shift: TimeClockShift) {
  return { ...shift, reviewFlags: [...shift.reviewFlags] };
}

function applyEvent(
  event: ClockEvent,
  shifts: Map<string, TimeClockShift>,
  adjustments: TimeClockAdjustment[],
): EventOutcome {
  const action = event.action as TimeClockAction;
  const eventMs = instant(event.occurredAt);
  if (!Number.isFinite(eventMs)) {
    return rejected('INVALID_EVENT_TIME', 'The event timestamp is invalid.');
  }

  if (action === 'clock_in') {
    const alreadyActive = activeShift(shifts.values(), event);
    if (alreadyActive) {
      return rejected(
        'ALREADY_CLOCKED_IN',
        `${event.tutorName} is already clocked in.`,
        alreadyActive.shiftId,
      );
    }
    const overlap = overlappingShift(
      shifts.values(),
      event,
      eventMs,
      null,
    );
    if (overlap) {
      return rejected(
        'OVERLAPPING_SHIFT',
        `Clocking in would overlap an existing shift for ${event.tutorName}.`,
        overlap.shiftId,
      );
    }
    const shift: TimeClockShift = {
      shiftId: event.targetShiftId,
      campusKey: event.campusKey,
      tutorId: event.tutorId,
      tutorName: event.tutorName,
      clockIn: event.occurredAt,
      clockOut: '',
      ...emptyHours(),
      status: 'active',
      clockInLat: event.latitude,
      clockInLng: event.longitude,
      clockInAccuracy: event.accuracy,
      clockInDistanceM: event.distanceM,
      clockInLocationVerified: truthy(event.locationVerified),
      clockOutLat: '',
      clockOutLng: '',
      clockOutAccuracy: '',
      clockOutDistanceM: '',
      clockOutLocationVerified: false,
      clockInBy: event.actorName,
      clockOutBy: '',
      clockInPerformedAs: event.actorRole === 'admin' ? 'admin' : 'tutor',
      clockOutPerformedAs: '',
      clockInNotes: event.notes,
      clockOutNotes: '',
      clockInAdminOverride: truthy(event.adminOverride),
      clockOutAdminOverride: false,
      clockInOverrideReason: event.overrideReason,
      clockOutOverrideReason: '',
      clockInRequestId: event.requestId,
      clockOutRequestId: '',
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
      edited: false,
      editCount: 0,
      version: 1,
      manual: false,
      voidedAt: '',
      voidedBy: '',
      voidReason: '',
      reviewFlags: [],
      lastEventId: event.eventId,
    };
    shifts.set(shift.shiftId, shift);
    return accepted(shift.shiftId, 'CLOCKED_IN');
  }

  if (action === 'clock_out') {
    const shift = shifts.get(event.targetShiftId);
    if (!shift || !sameTutor(shift, event) || shift.status !== 'active') {
      return rejected(
        'NO_ACTIVE_SHIFT',
        `${event.tutorName} is not currently clocked in.`,
      );
    }
    const expectedVersion = Number(event.baseVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== shift.version) {
      return rejected(
        'STALE_SHIFT',
        'The shift changed while the clock-out was being processed. Refresh and try again.',
        shift.shiftId,
      );
    }
    const startMs = instant(shift.clockIn);
    if (!Number.isFinite(startMs) || eventMs <= startMs) {
      return rejected(
        'INVALID_CLOCK_ORDER',
        'Clock-out must be after clock-in.',
        shift.shiftId,
      );
    }
    shift.clockOut = event.occurredAt;
    shift.clockOutLat = event.latitude;
    shift.clockOutLng = event.longitude;
    shift.clockOutAccuracy = event.accuracy;
    shift.clockOutDistanceM = event.distanceM;
    shift.clockOutLocationVerified = truthy(event.locationVerified);
    shift.clockOutBy = event.actorName;
    shift.clockOutPerformedAs = event.actorRole === 'admin' ? 'admin' : 'tutor';
    shift.clockOutNotes = event.notes;
    shift.clockOutAdminOverride = truthy(event.adminOverride);
    shift.clockOutOverrideReason = event.overrideReason;
    shift.clockOutRequestId = event.requestId;
    shift.updatedAt = event.occurredAt;
    shift.version += 1;
    shift.lastEventId = event.eventId;
    recalculateShift(shift);
    return accepted(shift.shiftId, 'CLOCKED_OUT');
  }

  if (event.actorRole !== 'admin') {
    return rejected('ADMIN_REQUIRED', 'Only an admin can apply this event.');
  }
  if (!event.reason) {
    return rejected('REASON_REQUIRED', 'A written reason is required.');
  }

  if (action === 'admin_create') {
    if (shifts.has(event.targetShiftId)) {
      return rejected('DUPLICATE_SHIFT_ID', 'That shift ID already exists.');
    }
    const startMs = instant(event.clockIn);
    const endMs = event.clockOut ? instant(event.clockOut) : null;
    if (
      !Number.isFinite(startMs) ||
      (endMs !== null && (!Number.isFinite(endMs) || endMs <= startMs))
    ) {
      return rejected('INVALID_CLOCK_ORDER', 'Clock-out must be after clock-in.');
    }
    const overlap = overlappingShift(
      shifts.values(),
      event,
      startMs,
      endMs,
    );
    if (overlap) {
      return rejected(
        'OVERLAPPING_SHIFT',
        `The manual shift overlaps another shift for ${event.tutorName}.`,
        overlap.shiftId,
      );
    }
    const shift: TimeClockShift = {
      shiftId: event.targetShiftId,
      campusKey: event.campusKey,
      tutorId: event.tutorId,
      tutorName: event.tutorName,
      clockIn: event.clockIn,
      clockOut: event.clockOut,
      ...emptyHours(),
      status: event.clockOut ? 'completed' : 'active',
      clockInLat: '',
      clockInLng: '',
      clockInAccuracy: '',
      clockInDistanceM: '',
      clockInLocationVerified: false,
      clockOutLat: '',
      clockOutLng: '',
      clockOutAccuracy: '',
      clockOutDistanceM: '',
      clockOutLocationVerified: false,
      clockInBy: event.actorName,
      clockOutBy: event.clockOut ? event.actorName : '',
      clockInPerformedAs: 'admin',
      clockOutPerformedAs: event.clockOut ? 'admin' : '',
      clockInNotes: event.notes,
      clockOutNotes: event.clockOut ? event.notes : '',
      clockInAdminOverride: true,
      clockOutAdminOverride: !!event.clockOut,
      clockInOverrideReason: event.reason,
      clockOutOverrideReason: event.clockOut ? event.reason : '',
      clockInRequestId: event.requestId,
      clockOutRequestId: event.clockOut ? event.requestId : '',
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
      edited: true,
      editCount: 1,
      version: 1,
      manual: true,
      voidedAt: '',
      voidedBy: '',
      voidReason: '',
      reviewFlags: [],
      lastEventId: event.eventId,
    };
    recalculateShift(shift);
    shifts.set(shift.shiftId, shift);
    adjustments.push(adjustmentFrom(event, 'created', null, cloneShift(shift)));
    return accepted(shift.shiftId, 'SHIFT_CREATED');
  }

  const shift = shifts.get(event.targetShiftId);
  if (!shift || lower(shift.campusKey) !== lower(event.campusKey)) {
    return rejected('SHIFT_NOT_FOUND', 'Shift not found.');
  }
  if (shift.status === 'voided') {
    return rejected('SHIFT_VOIDED', 'A voided shift cannot be changed again.', shift.shiftId);
  }
  const expectedVersion = Number(event.baseVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== shift.version) {
    return rejected(
      'STALE_SHIFT',
      'This shift was changed by another request. Refresh before trying again.',
      shift.shiftId,
    );
  }

  if (action === 'admin_edit') {
    const startMs = instant(event.clockIn);
    const endMs = event.clockOut ? instant(event.clockOut) : null;
    if (
      !Number.isFinite(startMs) ||
      (endMs !== null && (!Number.isFinite(endMs) || endMs <= startMs))
    ) {
      return rejected(
        'INVALID_CLOCK_ORDER',
        'Clock-out must be after clock-in.',
        shift.shiftId,
      );
    }
    const overlap = overlappingShift(
      shifts.values(),
      event,
      startMs,
      endMs,
      shift.shiftId,
    );
    if (overlap) {
      return rejected(
        'OVERLAPPING_SHIFT',
        `The corrected times overlap another shift for ${shift.tutorName}.`,
        overlap.shiftId,
      );
    }
    const before = cloneShift(shift);
    shift.clockIn = event.clockIn;
    shift.clockOut = event.clockOut;
    shift.updatedAt = event.occurredAt;
    shift.edited = true;
    shift.editCount += 1;
    shift.version += 1;
    shift.lastEventId = event.eventId;
    if (!event.clockOut) {
      shift.clockOutLat = '';
      shift.clockOutLng = '';
      shift.clockOutAccuracy = '';
      shift.clockOutDistanceM = '';
      shift.clockOutLocationVerified = false;
      shift.clockOutBy = '';
      shift.clockOutPerformedAs = '';
      shift.clockOutNotes = '';
      shift.clockOutAdminOverride = false;
      shift.clockOutOverrideReason = '';
      shift.clockOutRequestId = '';
    }
    recalculateShift(shift);
    adjustments.push(adjustmentFrom(event, 'edited', before, cloneShift(shift)));
    return accepted(shift.shiftId, 'SHIFT_EDITED');
  }

  if (action === 'admin_void') {
    const before = cloneShift(shift);
    shift.status = 'voided';
    shift.voidedAt = event.occurredAt;
    shift.voidedBy = event.actorName;
    shift.voidReason = event.reason;
    shift.updatedAt = event.occurredAt;
    shift.edited = true;
    shift.editCount += 1;
    shift.version += 1;
    shift.lastEventId = event.eventId;
    adjustments.push(adjustmentFrom(event, 'voided', before, cloneShift(shift)));
    return accepted(shift.shiftId, 'SHIFT_VOIDED');
  }

  return rejected('UNKNOWN_ACTION', 'The event action is not supported.');
}

function calculateReviewFlags(
  shifts: TimeClockShift[],
  nowMs: number,
  longShiftHours: number,
  openShiftAlertHours: number,
) {
  for (const shift of shifts) {
    const flags = new Set<string>();
    const startMs = instant(shift.clockIn);
    const endMs = shift.clockOut ? instant(shift.clockOut) : Number.NaN;
    if (!Number.isFinite(startMs) || (shift.clockOut && !Number.isFinite(endMs))) {
      flags.add('invalid_timestamps');
    }
    if (Number.isFinite(startMs) && startMs > nowMs + 5 * 60_000) {
      flags.add('future_clock_in');
    }
    if (shift.status === 'active' && Number.isFinite(startMs)) {
      if (durationHours(startMs, nowMs) >= openShiftAlertHours) {
        flags.add('open_over_limit');
      }
    } else if (
      shift.clockOut &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      durationHours(startMs, endMs) >= longShiftHours
    ) {
      flags.add('long_shift');
    }
    if (shift.unclassifiedHours > 0) flags.add('sunday_unclassified');
    if (shift.clockInAdminOverride) flags.add('clock_in_location_override');
    if (shift.clockOutAdminOverride) flags.add('clock_out_location_override');
    if (!shift.clockInLocationVerified && !shift.clockInAdminOverride) {
      flags.add('clock_in_location_unverified');
    }
    if (
      shift.status === 'completed' &&
      !shift.clockOutLocationVerified &&
      !shift.clockOutAdminOverride
    ) {
      flags.add('clock_out_location_unverified');
    }
    if (shift.manual) flags.add('manual_shift');
    shift.reviewFlags = Array.from(flags);
  }

  const live = shifts.filter((shift) => shift.status !== 'voided');
  for (let first = 0; first < live.length; first += 1) {
    for (let second = first + 1; second < live.length; second += 1) {
      if (!sameTutor(live[first], live[second] as any)) continue;
      const a = shiftInterval(live[first]);
      const b = shiftInterval(live[second]);
      if (intervalsOverlap(a.startMs, a.endMs, b.startMs, b.endMs)) {
        if (!live[first].reviewFlags.includes('overlapping_shift')) {
          live[first].reviewFlags.push('overlapping_shift');
        }
        if (!live[second].reviewFlags.includes('overlapping_shift')) {
          live[second].reviewFlags.push('overlapping_shift');
        }
      }
    }
  }
}

export function replayTimeClockEvents(
  inputRows: SheetRow[],
  options: {
    nowMs?: number;
    longShiftHours?: number;
    openShiftAlertHours?: number;
  } = {},
): ReplayResult {
  const config = timeClockConfigured();
  const events: ClockEvent[] = [];
  const shifts = new Map<string, TimeClockShift>();
  const adjustments: TimeClockAdjustment[] = [];
  const outcomes = new Map<string, EventOutcome>();
  const requestEvents = new Map<string, ClockEvent>();
  const requestOutcomes = new Map<string, EventOutcome>();
  const integrityWarnings: string[] = [];
  const allowedActions = new Set<TimeClockAction>([
    'clock_in',
    'clock_out',
    'admin_create',
    'admin_edit',
    'admin_void',
  ]);

  inputRows.forEach((row, sequence) => {
    const event = {} as ClockEvent;
    for (const header of EVENT_HEADERS) event[header] = norm(row?.[header]);
    event.sequence = sequence;
    if (!event.eventId) {
      integrityWarnings.push(`Event row ${sequence + 2} has no event ID and was ignored.`);
      return;
    }
    if (!event.eventHash || hashEvent(event) !== event.eventHash) {
      const outcome = rejected(
        'EVENT_INTEGRITY_FAILED',
        'The event row failed its integrity check and was ignored.',
      );
      outcomes.set(event.eventId, outcome);
      integrityWarnings.push(
        `Event ${event.eventId} failed its integrity check. Its row may have been edited outside the portal.`,
      );
      return;
    }
    if (
      event.schemaVersion !== '1' ||
      !event.requestId ||
      !event.requestFingerprint ||
      !event.campusKey ||
      !event.tutorName ||
      !event.actorName ||
      !event.targetShiftId ||
      !allowedActions.has(event.action as TimeClockAction)
    ) {
      const outcome = rejected('INVALID_EVENT', 'The event is incomplete and was ignored.');
      outcomes.set(event.eventId, outcome);
      integrityWarnings.push(`Event ${event.eventId} is incomplete and was ignored.`);
      return;
    }
    events.push(event);
    const key = requestKey(event);
    const originalEvent = requestEvents.get(key);
    const originalOutcome = requestOutcomes.get(key);
    if (originalEvent && originalOutcome) {
      if (originalEvent.requestFingerprint !== event.requestFingerprint) {
        outcomes.set(
          event.eventId,
          rejected(
            'IDEMPOTENCY_CONFLICT',
            'The same request ID was reused for a different operation.',
          ),
        );
      } else {
        outcomes.set(event.eventId, {
          ...originalOutcome,
          replayed: true,
          originalEventId: originalEvent.eventId,
        });
      }
      return;
    }
    const outcome = applyEvent(event, shifts, adjustments);
    outcomes.set(event.eventId, outcome);
    requestEvents.set(key, event);
    requestOutcomes.set(key, outcome);
  });

  const shiftList = Array.from(shifts.values());
  calculateReviewFlags(
    shiftList,
    options.nowMs ?? Date.now(),
    options.longShiftHours ?? config.longShiftHours,
    options.openShiftAlertHours ?? config.openShiftAlertHours,
  );
  return {
    events,
    shifts: shiftList,
    adjustments,
    outcomes,
    requestEvents,
    requestOutcomes,
    integrityWarnings,
  };
}

export type TimeClockState = ReplayResult & {
  sourceFingerprint: string;
  rawEventCount: number;
};

export class TimeClockError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TimeClockError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function shiftToRow(shift: TimeClockShift): SheetRow {
  return {
    ...shift,
    clockInLocationVerified: shift.clockInLocationVerified ? 'TRUE' : 'FALSE',
    clockOutLocationVerified: shift.clockOutLocationVerified ? 'TRUE' : 'FALSE',
    clockInAdminOverride: shift.clockInAdminOverride ? 'TRUE' : 'FALSE',
    clockOutAdminOverride: shift.clockOutAdminOverride ? 'TRUE' : 'FALSE',
    edited: shift.edited ? 'TRUE' : 'FALSE',
    manual: shift.manual ? 'TRUE' : 'FALSE',
    reviewFlags: shift.reviewFlags.join('|'),
  };
}

function adjustmentToRow(adjustment: TimeClockAdjustment): SheetRow {
  return { ...adjustment };
}

let storageReady:
  | { spreadsheetId: string; promise: Promise<void> }
  | undefined;

export async function ensureTimeClockStorage() {
  const config = timeClockConfigured();
  const spreadsheetId = timeClockSpreadsheetId();
  if (!config.sheets) {
    throw new TimeClockError(
      503,
      'STORAGE_NOT_CONFIGURED',
      !config.credentials
        ? 'Time Clock needs the portal Google service-account credentials.'
        : 'Time Clock needs TIME_CLOCK_SPREADSHEET_ID or GOOGLE_SHEETS_SPREADSHEET_ID.',
    );
  }
  if (
    storageReady &&
    storageReady.spreadsheetId === spreadsheetId
  ) {
    return storageReady.promise;
  }
  const names = timeClockSheetNames();
  const promise = (async () => {
    await ensureSheetHeaders(names.events, [...EVENT_HEADERS], spreadsheetId);
    await ensureSheetHeaders(names.shifts, [...SHIFT_HEADERS], spreadsheetId);
    await ensureSheetHeaders(
      names.adjustments,
      [...ADJUSTMENT_HEADERS],
      spreadsheetId,
    );
  })();
  storageReady = { spreadsheetId, promise };
  try {
    await promise;
  } catch (error) {
    if (storageReady?.promise === promise) storageReady = undefined;
    throw error;
  }
}

function rowsFingerprint(rows: SheetRow[]) {
  const compact = rows.map((row) => [norm(row.eventId), norm(row.eventHash)]);
  return crypto.createHash('sha256').update(JSON.stringify(compact)).digest('hex');
}

export async function loadTimeClockState(): Promise<TimeClockState> {
  await ensureTimeClockStorage();
  const names = timeClockSheetNames();
  const spreadsheetId = timeClockSpreadsheetId();
  const eventRows = await readSheetRows(names.events, spreadsheetId);
  if (!eventRows.length) {
    const legacyRows = await readSheetRows(names.shifts, spreadsheetId);
    if (legacyRows.length) {
      throw new TimeClockError(
        409,
        'LEGACY_DATA_REQUIRES_MIGRATION',
        'Existing Time Clock shifts were found without the event ledger. Stop and migrate those rows before accepting new clock actions.',
      );
    }
  }
  return {
    ...replayTimeClockEvents(eventRows),
    sourceFingerprint: rowsFingerprint(eventRows),
    rawEventCount: eventRows.length,
  };
}

export async function synchroniseTimeClockViews(
  initialState?: TimeClockState,
) {
  let state = initialState || (await loadTimeClockState());
  const names = timeClockSheetNames();
  const spreadsheetId = timeClockSpreadsheetId();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shiftHeaders = await ensureSheetHeaders(
      names.shifts,
      [...SHIFT_HEADERS],
      spreadsheetId,
    );
    const adjustmentHeaders = await ensureSheetHeaders(
      names.adjustments,
      [...ADJUSTMENT_HEADERS],
      spreadsheetId,
    );
    const existingShiftRows = await readSheetRows(names.shifts, spreadsheetId);
    const existingAdjustmentRows = await readSheetRows(
      names.adjustments,
      spreadsheetId,
    );
    const shiftsById = new Map(
      existingShiftRows.map((row) => [norm(row.shiftId), row]),
    );
    const adjustmentsById = new Map(
      existingAdjustmentRows.map((row) => [norm(row.adjustmentId), row]),
    );
    await overwriteSheetRows(
      names.shifts,
      shiftHeaders,
      state.shifts.map((shift) => ({
        ...(shiftsById.get(shift.shiftId) || {}),
        ...shiftToRow(shift),
      })),
      spreadsheetId,
    );
    await overwriteSheetRows(
      names.adjustments,
      adjustmentHeaders,
      state.adjustments.map((adjustment) => ({
        ...(adjustmentsById.get(adjustment.adjustmentId) || {}),
        ...adjustmentToRow(adjustment),
      })),
      spreadsheetId,
    );
    const latest = await loadTimeClockState();
    if (latest.sourceFingerprint === state.sourceFingerprint) return latest;
    // Another server instance appended an event while the views were being
    // written. Rebuild from the larger ledger so a stale writer cannot win.
    state = latest;
  }
  throw new TimeClockError(
    503,
    'VIEW_SYNC_BUSY',
    'The Time Clock changed repeatedly while payroll views were syncing. Please retry.',
  );
}

let mutationQueue: Promise<void> = Promise.resolve();

function queueMutation<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function recordTimeClockMutation(options: {
  campusKey: string;
  actorName: string;
  actorRole: 'admin' | 'tutor';
  requestId: string;
  fingerprint: string;
  buildEvent: (state: TimeClockState) => Partial<ClockEvent>;
}) {
  if (!validRequestId(options.requestId)) {
    throw new TimeClockError(
      400,
      'INVALID_REQUEST_ID',
      'A valid idempotency request ID is required.',
    );
  }
  return queueMutation(async () => {
    let before = await loadTimeClockState();
    const key = `${lower(options.campusKey)}|${lower(options.actorName)}|${options.requestId}`;
    const priorEvent = before.requestEvents.get(key);
    if (priorEvent) {
      if (priorEvent.requestFingerprint !== options.fingerprint) {
        throw new TimeClockError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'That request ID was already used for a different Time Clock action.',
        );
      }
      before = await synchroniseTimeClockViews(before);
      return {
        event: priorEvent,
        outcome: {
          ...(before.requestOutcomes.get(key) ||
            rejected('EVENT_NOT_FOUND', 'The original request could not be replayed.')),
          replayed: true,
        },
        state: before,
      };
    }

    const event = createClockEvent({
      ...options.buildEvent(before),
      requestId: options.requestId,
      requestFingerprint: options.fingerprint,
      campusKey: lower(options.campusKey),
      actorName: options.actorName,
      actorRole: options.actorRole,
    } as any);
    await appendSheetRows(
      timeClockSheetNames().events,
      [...EVENT_HEADERS],
      [event],
      timeClockSpreadsheetId(),
    );

    let after = await loadTimeClockState();
    for (let attempt = 0; attempt < 2 && !after.outcomes.has(event.eventId); attempt += 1) {
      after = await loadTimeClockState();
    }
    const outcome = after.outcomes.get(event.eventId);
    if (!outcome) {
      throw new TimeClockError(
        503,
        'EVENT_NOT_VISIBLE',
        'The clock event was submitted but is not visible yet. Retry with the same request.',
      );
    }
    after = await synchroniseTimeClockViews(after);
    return { event, outcome, state: after };
  });
}

export function findActiveShift(
  shifts: TimeClockShift[],
  campusKey: string,
  tutorId: string,
  tutorName = '',
) {
  return (
    shifts.find(
      (shift) =>
        lower(shift.campusKey) === lower(campusKey) &&
        shift.status === 'active' &&
        !shift.clockOut &&
        (tutorId
          ? shift.tutorId === tutorId
          : lower(shift.tutorName) === lower(tutorName)),
    ) || null
  );
}

export function publicShiftSnapshot(shift: TimeClockShift | null) {
  if (!shift) return null;
  return {
    shiftId: shift.shiftId,
    campusKey: shift.campusKey,
    tutorId: shift.tutorId,
    tutorName: shift.tutorName,
    clockIn: shift.clockIn,
    clockOut: shift.clockOut,
    status: shift.status,
    clockInBy: shift.clockInBy,
    clockOutBy: shift.clockOutBy,
    version: shift.version,
    reviewFlags: shift.reviewFlags,
  };
}

export type RangeShift = TimeClockShift & {
  rangeNormalMinutes: number;
  rangeAfter7Minutes: number;
  rangeSaturdayMinutes: number;
  rangeUnclassifiedMinutes: number;
  rangeElapsedMinutes: number;
  rangeNormalHours: number;
  rangeAfter7Hours: number;
  rangeSaturdayHours: number;
  rangeUnclassifiedHours: number;
  rangeElapsedHours: number;
  rangeClipped: boolean;
};

export type TutorPayrollSummary = {
  campusKey: string;
  tutorId: string;
  tutorName: string;
  shifts: number;
  normalMinutes: number;
  after7Minutes: number;
  saturdayMinutes: number;
  unclassifiedMinutes: number;
  totalMinutes: number;
  normalHours: number;
  after7Hours: number;
  saturdayHours: number;
  unclassifiedHours: number;
  totalHours: number;
  reviewCount: number;
};

export function buildPayrollRange(options: {
  state: TimeClockState;
  campusKey: string;
  startMs: number;
  endMs: number;
  nowMs?: number;
}) {
  const nowMs = options.nowMs ?? Date.now();
  const rows: RangeShift[] = [];
  for (const shift of options.state.shifts) {
    if (lower(shift.campusKey) !== lower(options.campusKey)) continue;
    const startMs = instant(shift.clockIn);
    if (!Number.isFinite(startMs)) continue;
    const storedEndMs = shift.clockOut ? instant(shift.clockOut) : Number.NaN;
    const displayEndMs = Number.isFinite(storedEndMs)
      ? storedEndMs
      : Math.max(startMs + 1, nowMs);
    const beginsInside = startMs >= options.startMs && startMs < options.endMs;
    const overlaps = clipInterval(
      startMs,
      displayEndMs,
      options.startMs,
      options.endMs,
    );
    if (!beginsInside && !overlaps) continue;

    let rangeHours = emptyHours();
    let rangeClipped = false;
    if (shift.status === 'completed' && Number.isFinite(storedEndMs)) {
      const clipped = clipInterval(
        startMs,
        storedEndMs,
        options.startMs,
        options.endMs,
      );
      if (clipped) {
        rangeHours = splitPaidHours(clipped.startMs, clipped.endMs);
        rangeClipped = clipped.startMs !== startMs || clipped.endMs !== storedEndMs;
      }
    }
    rows.push({
      ...shift,
      rangeNormalMinutes: rangeHours.normalMinutes,
      rangeAfter7Minutes: rangeHours.after7Minutes,
      rangeSaturdayMinutes: rangeHours.saturdayMinutes,
      rangeUnclassifiedMinutes: rangeHours.unclassifiedMinutes,
      rangeElapsedMinutes: rangeHours.elapsedMinutes,
      rangeNormalHours: rangeHours.normalHours,
      rangeAfter7Hours: rangeHours.after7Hours,
      rangeSaturdayHours: rangeHours.saturdayHours,
      rangeUnclassifiedHours: rangeHours.unclassifiedHours,
      rangeElapsedHours: rangeHours.elapsedHours,
      rangeClipped,
    });
  }
  rows.sort((first, second) => instant(second.clockIn) - instant(first.clockIn));

  const summaryMap = new Map<string, TutorPayrollSummary>();
  for (const row of rows) {
    if (row.status !== 'completed' || row.rangeElapsedHours <= 0) continue;
    const key = `${lower(row.campusKey)}|${row.tutorId || lower(row.tutorName)}`;
    const current = summaryMap.get(key) || {
      campusKey: row.campusKey,
      tutorId: row.tutorId,
      tutorName: row.tutorName,
      shifts: 0,
      normalMinutes: 0,
      after7Minutes: 0,
      saturdayMinutes: 0,
      unclassifiedMinutes: 0,
      totalMinutes: 0,
      normalHours: 0,
      after7Hours: 0,
      saturdayHours: 0,
      unclassifiedHours: 0,
      totalHours: 0,
      reviewCount: 0,
    };
    current.shifts += 1;
    current.normalMinutes += row.rangeNormalMinutes;
    current.after7Minutes += row.rangeAfter7Minutes;
    current.saturdayMinutes += row.rangeSaturdayMinutes;
    current.unclassifiedMinutes += row.rangeUnclassifiedMinutes;
    current.totalMinutes += row.rangeElapsedMinutes;
    if (row.reviewFlags.length) current.reviewCount += 1;
    summaryMap.set(key, current);
  }
  const summary = Array.from(summaryMap.values())
    .map((row) => ({
      ...row,
      normalHours: rounded(row.normalMinutes / 60),
      after7Hours: rounded(row.after7Minutes / 60),
      saturdayHours: rounded(row.saturdayMinutes / 60),
      unclassifiedHours: rounded(row.unclassifiedMinutes / 60),
      totalHours: rounded(row.totalMinutes / 60),
    }))
    .sort((first, second) => first.tutorName.localeCompare(second.tutorName));

  const shiftIds = new Set(rows.map((row) => row.shiftId));
  const adjustments = options.state.adjustments
    .filter(
      (adjustment) =>
        lower(adjustment.campusKey) === lower(options.campusKey) &&
        shiftIds.has(adjustment.shiftId),
    )
    .sort((first, second) => instant(second.changedAt) - instant(first.changedAt));
  return { rows, summary, adjustments };
}

export function statusForOutcome(outcome: EventOutcome) {
  if (outcome.accepted) return 200;
  if (
    outcome.code === 'ALREADY_CLOCKED_IN' ||
    outcome.code === 'NO_ACTIVE_SHIFT' ||
    outcome.code === 'STALE_SHIFT' ||
    outcome.code === 'OVERLAPPING_SHIFT' ||
    outcome.code === 'SHIFT_VOIDED' ||
    outcome.code === 'IDEMPOTENCY_CONFLICT'
  ) {
    return 409;
  }
  if (outcome.code === 'SHIFT_NOT_FOUND') return 404;
  if (outcome.code === 'ADMIN_REQUIRED') return 403;
  return 400;
}
