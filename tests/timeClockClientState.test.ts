import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_CLOCK_STATUS_STORAGE_KEY,
  clearTimeClockStatus,
  getRememberedTimeClockStatus,
  normaliseTimeClockStatus,
  readTimeClockStatus,
  rememberTimeClockStatus,
} from '../lib/timeClockClientState';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

const nowMs = Date.parse('2026-09-02T23:38:39.000Z');
const activeStatus = {
  version: 1,
  tutor: 'Kevin',
  campus: 'parramatta',
  activeShift: {
    shiftId: 'shift_1',
    tutorName: 'Kevin',
    clockIn: '2026-09-02T23:38:39.000Z',
    clockOut: '',
    status: 'active',
  },
  updatedAt: nowMs,
};

test('keeps a valid active status scoped to the signed-in tutor and campus', () => {
  const status = normaliseTimeClockStatus(activeStatus, {
    tutor: 'kevin',
    campus: 'Parramatta',
    nowMs,
  });
  assert.equal(status?.activeShift?.shiftId, 'shift_1');
  assert.equal(
    normaliseTimeClockStatus(activeStatus, {
      tutor: 'Another Tutor',
      campus: 'parramatta',
      nowMs,
    }),
    null,
  );
});

test('rejects expired, completed, and malformed cached active shifts', () => {
  assert.equal(
    normaliseTimeClockStatus(activeStatus, {
      nowMs: nowMs + 49 * 60 * 60 * 1_000,
    }),
    null,
  );
  assert.equal(
    normaliseTimeClockStatus({
      ...activeStatus,
      activeShift: { ...activeStatus.activeShift, status: 'completed' },
    }, { nowMs }),
    null,
  );
});

test('persists status for navigation and clears it on logout', () => {
  const storage = memoryStorage();
  const currentNowMs = Date.now();
  const currentStatus = {
    ...activeStatus,
    activeShift: {
      ...activeStatus.activeShift,
      clockIn: new Date(currentNowMs - 60_000).toISOString(),
    },
    updatedAt: currentNowMs,
  };
  clearTimeClockStatus(storage);
  assert.ok(rememberTimeClockStatus(currentStatus, storage));
  assert.ok(storage.getItem(TIME_CLOCK_STATUS_STORAGE_KEY));
  assert.equal(
    readTimeClockStatus(storage, {
      tutor: 'Kevin',
      campus: 'parramatta',
      nowMs: currentNowMs,
    })
      ?.activeShift?.shiftId,
    'shift_1',
  );
  assert.equal(
    getRememberedTimeClockStatus({
      tutor: 'Kevin',
      campus: 'parramatta',
      nowMs: currentNowMs,
    })
      ?.activeShift?.shiftId,
    'shift_1',
  );
  clearTimeClockStatus(storage);
  assert.equal(storage.getItem(TIME_CLOCK_STATUS_STORAGE_KEY), null);
  assert.equal(getRememberedTimeClockStatus({ nowMs: currentNowMs }), null);
});
