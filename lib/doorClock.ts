/** Door links grant attendance access only. They are not portal sessions or proof of NFC proximity. */
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { appendSheetRows, readSheetRows } from './googleSheets';
import { loadTutorConfigWithMeta } from './tutorConfig';
import { TimeClockError, timeClockConfigured, timeClockSpreadsheetId, tutorIdFor } from './timeClock';

export const DOOR_HEADERS = ['eventId', 'campusKey', 'linkId', 'enabled', 'tokenHash', 'label', 'createdAt', 'createdBy'] as const;
export type DoorLink = { eventId: string; campusKey: string; linkId: string; enabled: boolean; tokenHash: string; label: string; createdAt: string; createdBy: string };
export type DoorTutor = { id: string; name: string };
const norm = (value: unknown) => String(value ?? '').trim();
export const doorTokenHash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const validDoorToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const doorSheetName = () => norm(process.env.DOOR_CLOCK_LINKS_SHEET_NAME) || 'door_clock_links';

export function doorHeaders(res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

export function requireDoorPost(req: NextApiRequest) {
  if (!/^application\/json(?:\s*;|$)/i.test(norm(req.headers['content-type']))) {
    throw new TimeClockError(415, 'JSON_REQUIRED', 'Please reload this page and try again.');
  }
  const origin = norm(req.headers.origin);
  const host = norm(req.headers.host).toLowerCase();
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host.toLowerCase() !== host || parsed.username || parsed.password) throw new Error();
  } catch {
    throw new TimeClockError(403, 'ORIGIN_REQUIRED', 'Open the door link on this site before continuing.');
  }
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    throw new TimeClockError(403, 'ORIGIN_REQUIRED', 'Open the door link on this site before continuing.');
  }
}

// A best-effort per-instance burst guard, not a distributed rate limiter.
const bursts = new Map<string, { at: number; count: number }>();
export function limitDoorRequests(req: NextApiRequest, now = Date.now()) {
  const key = norm(req.headers['x-forwarded-for']).split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (bursts.size > 2000) for (const [id, entry] of bursts) if (now - entry.at >= 60000) bursts.delete(id);
  const entry = bursts.get(key);
  if (entry && now - entry.at < 60000) {
    entry.count += 1;
    if (entry.count > 180) throw new TimeClockError(429, 'SLOW_DOWN', 'Too many requests. Please wait a minute and try again.');
  } else {
    if (bursts.size >= 4000) bursts.delete(bursts.keys().next().value!);
    bursts.set(key, { at: now, count: 1 });
  }
}

/** Preview deployments may share live Sheets with an older production reader. */
export function assertDoorWritesAllowed() {
  if (process.env.VERCEL_ENV !== 'preview') return;
  const staging = norm(process.env.TIME_CLOCK_SPREADSHEET_ID);
  const separateStaging = !!staging && staging !== norm(process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
  if (process.env.DOOR_CLOCK_ALLOW_PREVIEW_WRITES !== 'true' || !separateStaging) {
    throw new TimeClockError(503, 'PREVIEW_READ_ONLY', 'Door clock writes are disabled in this preview. Use an isolated staging spreadsheet or the deployed production release.');
  }
}

/** Physical append order is authoritative. GET never creates the settings tab. */
export async function loadDoorLinks(): Promise<DoorLink[]> {
  if (!timeClockConfigured().sheets) throw new TimeClockError(503, 'STORAGE_NOT_CONFIGURED', 'Time Clock storage is not configured. Please contact your centre manager.');
  let rows: Record<string, any>[];
  try { rows = await readSheetRows(doorSheetName(), timeClockSpreadsheetId()); }
  catch (error) {
    // Only an absent tab is empty. Permissions, quota and network failures remain errors.
    if (/unable to parse range|sheet[^\n]*(?:not found|does not exist)/i.test(String((error as Error)?.message || error))) return [];
    throw error;
  }
  const latest = new Map<string, DoorLink>();
  for (const row of rows) {
    const campusKey = norm(row.campusKey).toLowerCase();
    if (!campusKey) continue;
    // A malformed latest row disables access instead of resurrecting an older token.
    const link: DoorLink = {
      eventId: norm(row.eventId), campusKey, linkId: norm(row.linkId),
      enabled: row.enabled === true || norm(row.enabled).toUpperCase() === 'TRUE',
      tokenHash: norm(row.tokenHash), label: norm(row.label),
      createdAt: norm(row.createdAt), createdBy: norm(row.createdBy),
    };
    if (!link.eventId || !link.linkId || !/^[a-f0-9]{64}$/.test(link.tokenHash)) link.enabled = false;
    latest.set(campusKey, link);
  }
  return [...latest.values()];
}

export async function requireDoorLink(req: NextApiRequest): Promise<DoorLink> {
  limitDoorRequests(req);
  const token = req.headers['x-st-door-key'];
  if (!validDoorToken(token)) throw new TimeClockError(401, 'DOOR_LINK_REQUIRED', 'Tap the centre NFC tag or scan its QR code to begin.');
  const digest = Buffer.from(doorTokenHash(token), 'hex');
  const links = await loadDoorLinks();
  const match = links.find(link => link.enabled && /^[a-f0-9]{64}$/.test(link.tokenHash) && crypto.timingSafeEqual(Buffer.from(link.tokenHash, 'hex'), digest));
  if (!match) throw new TimeClockError(401, 'DOOR_LINK_INVALID', 'This door link is no longer active. Please tap the current tag or contact your centre manager.');
  return match;
}

export async function doorTutors(campusKey: string): Promise<DoorTutor[]> {
  const loaded = await loadTutorConfigWithMeta();
  // Do not use a potentially stale CSV fallback to authorise an inactive tutor.
  if (loaded.warning && loaded.source !== 'campuses-json') throw new TimeClockError(503, 'TUTORS_UNAVAILABLE', 'The tutor list could not be checked. Please try again shortly.');
  return loaded.tutors.filter(t => t.active && t.campusKey.toLowerCase() === campusKey.toLowerCase())
    .map(t => ({ id: tutorIdFor(t.campusKey, t.tutorName, t.email), name: t.tutorName }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function changeDoorLink(campus: string, actor: string, action: 'create' | 'rotate' | 'disable') {
  assertDoorWritesAllowed();
  const links = await loadDoorLinks();
  const current = links.find(link => link.campusKey === campus.toLowerCase());
  if (action === 'create' && current?.enabled) throw new TimeClockError(409, 'LINK_EXISTS', 'A door link is already active. Replace it to issue a new link.');
  if (action === 'disable' && !current?.enabled) return { link: current || null, token: '' };
  const token = action === 'disable' ? '' : crypto.randomBytes(32).toString('base64url');
  const link: DoorLink = {
    eventId: crypto.randomUUID(), campusKey: campus.toLowerCase(),
    linkId: action === 'disable' ? current!.linkId : crypto.randomUUID(),
    enabled: action !== 'disable', tokenHash: token ? doorTokenHash(token) : current!.tokenHash,
    label: 'Front door', createdAt: new Date().toISOString(), createdBy: actor,
  };
  await appendSheetRows(doorSheetName(), [...DOOR_HEADERS], [{ ...link, enabled: link.enabled ? 'TRUE' : 'FALSE' }], timeClockSpreadsheetId());
  return { link, token };
}

export function doorError(res: NextApiResponse, error: unknown) {
  if (error instanceof TimeClockError) {
    if (error.status === 429) res.setHeader('Retry-After', '60');
    return res.status(error.status).json({ ok: false, code: error.code, error: error.message });
  }
  // Never expose Google credentials, worksheet contents, access URLs or raw upstream errors.
  console.error('[door-clock] upstream request failed');
  return res.status(503).json({ ok: false, code: 'TEMPORARILY_UNAVAILABLE', error: 'Your action could not be confirmed. Please try again; retries will not create a second shift.' });
}
