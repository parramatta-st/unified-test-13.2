import type { NextApiRequest, NextApiResponse } from 'next';
import { assertDoorWritesAllowed, doorHeaders, requireDoorLink, requireDoorPost, doorTutors, doorError } from '../../lib/doorClock';
import { TimeClockError, findActiveShift, loadTimeClockState, newTimeClockId, recordTimeClockMutation, requestFingerprint, statusForOutcome } from '../../lib/timeClock';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  doorHeaders(res);
  if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, error: 'Method not allowed.' }); }
  try {
    if (req.method === 'POST') { requireDoorPost(req); assertDoorWritesAllowed(); }
    const link = await requireDoorLink(req);
    const tutors = await doorTutors(link.campusKey);
    const requestedId = req.method === 'GET' ? req.query.tutorId : req.body?.tutorId;
    const selected = typeof requestedId === 'string' ? tutors.find(t => t.id === requestedId) : null;
    if (req.method === 'GET') {
      let active = null;
      if (selected) {
        const state = await loadTimeClockState();
        if (state.integrityWarnings.length) throw new TimeClockError(409, 'LEDGER_REVIEW', 'A Time Clock record needs manager review before a new action can be recorded.');
        const shift = findActiveShift(state.shifts, link.campusKey, selected.id, selected.name);
        active = shift ? { shiftId: shift.shiftId, clockIn: shift.clockIn, version: shift.version, needsReview: shift.reviewFlags.length > 0 } : null;
      }
      return res.status(200).json({ ok: true, campus: link.campusKey, linkId: link.linkId, campusName: process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring', tutors, selectedId: selected?.id || '', activeShift: active, serverTime: new Date().toISOString() });
    }
    if (!selected) throw new TimeClockError(403, 'TUTOR_NOT_ACTIVE', 'Choose an active tutor from this centre.');
    const action = req.body?.action;
    if (action !== 'clock_in' && action !== 'clock_out') throw new TimeClockError(400, 'INVALID_ACTION', 'Choose Clock In or Clock Out.');
    const expectedShiftId = req.body?.expectedShiftId;
    const expectedVersion = req.body?.expectedVersion;
    if (typeof expectedShiftId !== 'string' || !Number.isInteger(expectedVersion) || expectedVersion < 0 ||
        (action === 'clock_in' && (expectedShiftId !== '' || expectedVersion !== 0)) ||
        (action === 'clock_out' && (!expectedShiftId || expectedVersion < 1))) {
      throw new TimeClockError(400, 'INVALID_STATE', 'Refresh your shift before continuing.');
    }
    const result = await recordTimeClockMutation({
      campusKey: link.campusKey, actorName: selected.name, actorRole: 'tutor',
      requestId: req.body?.requestId,
      fingerprint: requestFingerprint({ method: 'door_link', linkId: link.linkId, tutorId: selected.id, action, expectedShiftId, expectedVersion }),
      buildEvent: state => {
        if (state.integrityWarnings.length) throw new TimeClockError(409, 'LEDGER_REVIEW', 'A Time Clock record needs manager review before continuing.');
        const active = findActiveShift(state.shifts, link.campusKey, selected.id, selected.name);
        if ((action === 'clock_in' && active) || (action === 'clock_out' && (!active || active.shiftId !== expectedShiftId || active.version !== expectedVersion))) {
          throw new TimeClockError(409, 'STALE_SHIFT', 'Your shift has changed. Refresh to see the correct action.');
        }
        return {
          tutorId: selected.id, tutorName: selected.name, action, occurredAt: new Date().toISOString(),
          targetShiftId: active?.shiftId || newTimeClockId('shift'), baseVersion: active ? String(active.version) : '',
          accessMethod: 'door_link', accessPoint: link.linkId, identityMethod: 'name_selection',
          // No invented GPS verification and no pretend administrator override.
          locationVerified: 'FALSE', adminOverride: 'FALSE',
          notes: 'Centre door link (NFC / QR). Name selected by tutor; location not requested.',
        };
      },
    });
    if (!result.outcome.accepted) return res.status(statusForOutcome(result.outcome)).json({ ok: false, code: result.outcome.code, error: result.outcome.error });
    return res.status(200).json({ ok: true, action, tutorName: selected.name, timestamp: result.event.occurredAt, replayed: !!result.outcome.replayed });
  } catch (error) { return doorError(res, error); }
}
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
