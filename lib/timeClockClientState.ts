export const TIME_CLOCK_STATUS_STORAGE_KEY = 'st_time_clock_status_v1';

const STATUS_VERSION = 1;
const MAX_STATUS_AGE_MS = 48 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export type TimeClockShiftSnapshot = {
  shiftId: string;
  tutorName: string;
  clockIn: string;
  clockOut: string;
  status: string;
  reviewFlags?: string[];
};

export type TimeClockStatusSnapshot = {
  version: 1;
  tutor: string;
  campus: string;
  activeShift: TimeClockShiftSnapshot | null;
  updatedAt: number;
};

type ClockStatusStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let memoryStatus: TimeClockStatusSnapshot | null = null;

function norm(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return norm(value).toLowerCase();
}

function normaliseShift(value: unknown, tutor: string): TimeClockShiftSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<TimeClockShiftSnapshot>;
  const shiftId = norm(input.shiftId);
  const tutorName = norm(input.tutorName);
  const clockIn = norm(input.clockIn);
  const clockOut = norm(input.clockOut);
  const status = norm(input.status);
  if (
    !shiftId ||
    !tutorName ||
    lower(tutorName) !== lower(tutor) ||
    !Number.isFinite(Date.parse(clockIn)) ||
    clockOut ||
    status !== 'active'
  ) {
    return null;
  }
  return {
    shiftId,
    tutorName,
    clockIn,
    clockOut: '',
    status,
    reviewFlags: Array.isArray(input.reviewFlags)
      ? input.reviewFlags.map(norm).filter(Boolean).slice(0, 20)
      : [],
  };
}

export function normaliseTimeClockStatus(
  value: unknown,
  options: {
    tutor?: string;
    campus?: string;
    nowMs?: number;
  } = {},
): TimeClockStatusSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<TimeClockStatusSnapshot>;
  const tutor = norm(input.tutor);
  const campus = norm(input.campus);
  const updatedAt = Number(input.updatedAt);
  const nowMs = options.nowMs ?? Date.now();
  if (
    Number(input.version) !== STATUS_VERSION ||
    !tutor ||
    !campus ||
    !Number.isFinite(updatedAt) ||
    updatedAt < nowMs - MAX_STATUS_AGE_MS ||
    updatedAt > nowMs + MAX_FUTURE_SKEW_MS ||
    (options.tutor && lower(options.tutor) !== lower(tutor)) ||
    (options.campus && lower(options.campus) !== lower(campus))
  ) {
    return null;
  }
  if (input.activeShift === null) {
    return { version: STATUS_VERSION, tutor, campus, activeShift: null, updatedAt };
  }
  const activeShift = normaliseShift(input.activeShift, tutor);
  if (!activeShift) return null;
  return { version: STATUS_VERSION, tutor, campus, activeShift, updatedAt };
}

export function getRememberedTimeClockStatus(options: {
  tutor?: string;
  campus?: string;
  nowMs?: number;
} = {}) {
  const status = normaliseTimeClockStatus(memoryStatus, options);
  if (!status) memoryStatus = null;
  return status;
}

export function readTimeClockStatus(
  storage: Pick<ClockStatusStorage, 'getItem'>,
  options: {
    tutor?: string;
    campus?: string;
    nowMs?: number;
  } = {},
) {
  try {
    const raw = storage.getItem(TIME_CLOCK_STATUS_STORAGE_KEY);
    if (!raw) return null;
    return normaliseTimeClockStatus(JSON.parse(raw), options);
  } catch {
    return null;
  }
}

export function rememberTimeClockStatus(
  value: unknown,
  storage?: Pick<ClockStatusStorage, 'setItem'>,
) {
  const status = normaliseTimeClockStatus(value);
  if (!status) return null;
  memoryStatus = status;
  try {
    storage?.setItem(TIME_CLOCK_STATUS_STORAGE_KEY, JSON.stringify(status));
  } catch {}
  return status;
}

export function clearTimeClockStatus(
  storage?: Pick<ClockStatusStorage, 'removeItem'>,
) {
  memoryStatus = null;
  try {
    storage?.removeItem(TIME_CLOCK_STATUS_STORAGE_KEY);
  } catch {}
}
