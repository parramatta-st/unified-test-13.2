/** Local convenience state only. This does not authenticate anyone to the portal. */
export const DOOR_CHOICE_KEY = 'st_door_choice_v1';
export const DOOR_TOKEN_KEY = 'st_door_token_v1';
export type DoorChoice = { campus: string; tutorId: string };
export type DoorPending = { requestId: string; tutorId: string; action: 'clock_in' | 'clock_out'; expectedShiftId: string; expectedVersion: number; createdAt: number };
export function readDoorChoice(storage: Pick<Storage, 'getItem'>): DoorChoice | null {
  try {
    const value = JSON.parse(storage.getItem(DOOR_CHOICE_KEY) || 'null');
    return typeof value?.campus === 'string' && typeof value?.tutorId === 'string' ? value : null;
  } catch { return null; }
}
export function pendingKey(campus: string, linkId: string) { return `st_door_pending_v1_${campus}_${linkId}`; }
export function readDoorPending(storage: Pick<Storage, 'getItem'>, key: string): DoorPending | null {
  try {
    const p = JSON.parse(storage.getItem(key) || 'null');
    return p && /^[A-Za-z0-9_-]{16,128}$/.test(p.requestId) && typeof p.tutorId === 'string' &&
      ['clock_in', 'clock_out'].includes(p.action) && typeof p.expectedShiftId === 'string' &&
      Number.isInteger(p.expectedVersion) && p.expectedVersion >= 0 && Number.isFinite(p.createdAt) ? p : null;
  } catch { return null; }
}
export function doorTime(value: string, includeDate = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', ...(includeDate ? { day: 'numeric', month: 'short' } as const : {}) }).format(date);
}
export function doorDuration(start: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(start)) / 60000));
  if (!Number.isFinite(minutes)) return '';
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function newDoorRequestId() {
  if (typeof crypto.randomUUID === 'function') return `door_${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return 'door_' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
