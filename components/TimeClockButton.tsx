import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TIME_CLOCK_STATUS_STORAGE_KEY,
  getRememberedTimeClockStatus,
  normaliseTimeClockStatus,
  readTimeClockStatus,
  rememberTimeClockStatus,
  type TimeClockShiftSnapshot,
} from '../lib/timeClockClientState';
import { hasWrittenOverrideReason } from '../lib/timeClockValidation';

type ShiftSnapshot = TimeClockShiftSnapshot;

type ClockState = {
  ok?: boolean;
  tutor?: string;
  campus?: string;
  isAdmin?: boolean;
  activeShift?: ShiftSnapshot | null;
  activeShifts?: ShiftSnapshot[];
  tutors?: string[];
  config?: {
    sheets: boolean;
    geofence: boolean;
    geofenceError?: string;
    radiusM: number;
    maxAccuracyM: number;
  };
  error?: string;
};

type LocationPhase = 'idle' | 'requesting' | 'verifying' | 'verified' | 'error';

let sharedStateRequest: Promise<ClockState> | null = null;
let sharedServerState: ClockState | null = null;
let sharedServerStateAt = 0;
let sharedRequestGeneration = 0;

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function invalidateSharedStateRequest() {
  sharedRequestGeneration += 1;
  sharedStateRequest = null;
  sharedServerState = null;
  sharedServerStateAt = 0;
}

async function requestClockState(force = false) {
  if (
    !force &&
    sharedServerState &&
    Date.now() - sharedServerStateAt < 3_000
  ) {
    return sharedServerState;
  }
  if (sharedStateRequest) return sharedStateRequest;

  const generation = sharedRequestGeneration;
  const request = (async () => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch('/api/time-clock', { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          const requestError = new Error(json?.error || 'Time Clock is unavailable.');
          (requestError as any).status = response.status;
          throw requestError;
        }
        return json as ClockState;
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error('Time Clock is unavailable.');
        const status = Number(error?.status || 0);
        if (attempt === 0 && (!status || status >= 500)) {
          await delay(350);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError || new Error('Time Clock is unavailable.');
  })();
  sharedStateRequest = request;
  try {
    const state = await request;
    if (generation === sharedRequestGeneration) {
      sharedServerState = state;
      sharedServerStateAt = Date.now();
    }
    return state;
  } finally {
    if (sharedStateRequest === request) sharedStateRequest = null;
  }
}

function currentSessionIdentity() {
  if (typeof window === 'undefined') return { tutor: '', campus: '' };
  try {
    return {
      tutor: localStorage.getItem('st_tutor') || '',
      campus: localStorage.getItem('st_campus') || '',
    };
  } catch {
    return { tutor: '', campus: '' };
  }
}

function rememberedStatusForCurrentSession() {
  if (typeof window === 'undefined') return null;
  return getRememberedTimeClockStatus(currentSessionIdentity());
}

function statusState(status: ReturnType<typeof getRememberedTimeClockStatus>): ClockState {
  return status
    ? {
        ok: true,
        tutor: status.tutor,
        campus: status.campus,
        activeShift: status.activeShift,
      }
    : {};
}

function cacheClockStatus(state: ClockState) {
  if (typeof window === 'undefined' || !state.tutor || !state.campus) return null;
  return rememberTimeClockStatus(
    {
      version: 1,
      tutor: state.tutor,
      campus: state.campus,
      activeShift: state.activeShift || null,
      updatedAt: Date.now(),
    },
    window.localStorage,
  );
}

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function elapsed(value?: string) {
  if (!value) return '';
  const milliseconds = Date.now() - Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const minutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `clock_${crypto.randomUUID()}`;
  }
  return `clock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function locationError(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Location permission was denied. Allow location for this site in your browser settings, then try again.';
  }
  if (error.code === error.TIMEOUT) {
    return 'Location timed out. Move closer to a window, make sure precise location is enabled, and try again.';
  }
  return 'Your device could not determine its location. Check that location services are on and try again near the centre.';
}

export default function TimeClockButton() {
  const initialStatus = rememberedStatusForCurrentSession();
  const [state, setState] = useState<ClockState>(() => statusState(initialStatus));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(!initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [locationPhase, setLocationPhase] = useState<LocationPhase>('idle');
  const [locationDetail, setLocationDetail] = useState('');
  const [, setTick] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pendingRequest = useRef<{ signature: string; requestId: string } | null>(null);
  const stateRevision = useRef(0);

  const load = useCallback(async (force = false) => {
    const revision = stateRevision.current;
    try {
      const json = await requestClockState(force);
      if (revision !== stateRevision.current) return;
      setState(json);
      setTarget((current) => current || json.tutor || '');
      cacheClockStatus(json);
    } catch (loadError: any) {
      if (revision !== stateRevision.current) return;
      setState((current) => ({
        ...current,
        ok: false,
        error: loadError?.message || 'Time Clock is unavailable.',
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const applyStatus = (value: unknown) => {
      const status = normaliseTimeClockStatus(value, currentSessionIdentity());
      if (!status) return;
      invalidateSharedStateRequest();
      stateRevision.current += 1;
      rememberTimeClockStatus(status);
      setState((current) => ({
        ...current,
        ok: true,
        tutor: status.tutor,
        campus: status.campus,
        activeShift: status.activeShift,
        error: undefined,
      }));
      setTarget((current) => current || status.tutor);
      setLoading(false);
    };
    const stored = readTimeClockStatus(window.localStorage, currentSessionIdentity());
    if (stored) applyStatus(stored);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TIME_CLOCK_STATUS_STORAGE_KEY) return;
      if (!event.newValue) {
        invalidateSharedStateRequest();
        stateRevision.current += 1;
        setState((current) => ({ ...current, activeShift: null }));
        void load(true);
        return;
      }
      try {
        applyStatus(JSON.parse(event.newValue));
      } catch {}
    };

    void load();
    const tickId = window.setInterval(() => setTick((value) => value + 1), 30_000);
    const refreshId = window.setInterval(() => void load(true), 120_000);
    const onFocus = () => void load(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(tickId);
      window.clearInterval(refreshId);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const focusId = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.cancelAnimationFrame(focusId);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy]);

  const activeForTarget = useMemo(() => {
    if (!target) return null;
    if (target.toLowerCase() === String(state.tutor || '').toLowerCase()) {
      return state.activeShift || null;
    }
    return (
      (state.activeShifts || []).find(
        (shift) => shift.tutorName.toLowerCase() === target.toLowerCase(),
      ) || null
    );
  }, [target, state.activeShift, state.activeShifts, state.tutor]);

  function requestLocation() {
    return new Promise<{ latitude: number; longitude: number; accuracy: number }>(
      (resolve, reject) => {
        if (!navigator.geolocation) {
          reject(
            new Error(
              'This browser does not support location. Try a current version of Safari, Chrome, or Edge.',
            ),
          );
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) =>
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            }),
          (positionError) => reject(new Error(locationError(positionError))),
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
        );
      },
    );
  }

  function openClock() {
    setOpen(true);
    setError('');
    setMessage('');
    setNotes('');
    setOverride(false);
    setOverrideReason('');
    setLocationPhase('idle');
    setLocationDetail('');
    setTarget(state.tutor || '');
    void load(true);
  }

  async function act() {
    if (!target || busy) return;
    if (override && !hasWrittenOverrideReason(overrideReason)) {
      setError('Enter a written reason for the admin location override.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    setLocationDetail('');
    let response: Response | null = null;
    try {
      let location = null;
      if (!override) {
        setLocationPhase('requesting');
        location = await requestLocation();
        setLocationPhase('verifying');
        setLocationDetail(
          `Location acquired with approximately ${Math.round(location.accuracy)} m accuracy.`,
        );
      } else {
        setLocationPhase('idle');
      }
      const action = activeForTarget ? 'clock_out' : 'clock_in';
      const signature = `${action}|${target.toLowerCase()}|${activeForTarget?.shiftId || ''}`;
      if (!pendingRequest.current || pendingRequest.current.signature !== signature) {
        pendingRequest.current = { signature, requestId: newRequestId() };
      }
      response = await fetch('/api/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          tutorName: target,
          location,
          notes,
          adminOverride: override,
          overrideReason,
          requestId: pendingRequest.current.requestId,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        const actionError: any = new Error(
          json?.error || 'The Time Clock action failed. Please try again.',
        );
        actionError.code = json?.code;
        actionError.status = response.status;
        throw actionError;
      }
      pendingRequest.current = null;
      setLocationPhase(override ? 'idle' : 'verified');
      setLocationDetail(
        override
          ? 'Admin override recorded with your name and reason.'
          : `Location verified${json?.location?.distanceM != null ? ` · ${Math.round(json.location.distanceM)} m from centre` : ''}.`,
      );
      setMessage(json.message || 'Time Clock updated.');
      setNotes('');
      setOverride(false);
      setOverrideReason('');
      const completedAction = action;
      const completedTarget = target;
      const returnedShift = json.shift as ShiftSnapshot | null;
      invalidateSharedStateRequest();
      stateRevision.current += 1;
      const nextState = (() => {
        const current = state;
        const isSelf =
          completedTarget.toLowerCase() === String(current.tutor || '').toLowerCase();
        const remainingActiveShifts = (current.activeShifts || []).filter(
          (shift) =>
            shift.tutorName.toLowerCase() !== completedTarget.toLowerCase(),
        );
        return {
          ...current,
          activeShift: isSelf
            ? completedAction === 'clock_in'
              ? returnedShift
              : null
            : current.activeShift,
          activeShifts: current.isAdmin
            ? completedAction === 'clock_in' && returnedShift
              ? [returnedShift, ...remainingActiveShifts]
              : remainingActiveShifts
            : current.activeShifts,
        };
      })();
      setState(nextState);
      cacheClockStatus(nextState);
      window.setTimeout(() => {
        setOpen(false);
        setMessage('');
      }, 650);
      void load(true);
    } catch (actionError: any) {
      if (response && response.status < 500) pendingRequest.current = null;
      setLocationPhase('error');
      setError(actionError?.message || 'The Time Clock action failed.');
      if (
        state.isAdmin &&
        ['LOCATION_INACCURATE', 'OUTSIDE_GEOFENCE', 'GEOFENCE_NOT_CONFIGURED'].includes(
          actionError?.code,
        )
      ) {
        setLocationDetail('If appropriate, use the logged admin override below.');
      }
    } finally {
      setBusy(false);
    }
  }

  const selfActive = state.activeShift;
  const triggerText = selfActive
    ? 'Clocked In'
    : loading
      ? 'Time Clock'
      : 'Clock In';
  const actionDisabled =
    busy ||
    loading ||
    !state.config?.sheets ||
    (!state.config?.geofence && !override) ||
    !target;

  return (
    <>
      <button
        type="button"
        className={`time-clock-trigger ${selfActive ? 'is-active' : ''}`}
        onClick={openClock}
        aria-label={
          selfActive
            ? `Open Time Clock. Clocked in for ${elapsed(selfActive.clockIn)}.`
            : 'Open Time Clock to clock in.'
        }
      >
        <span className="clock-symbol" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5v5l3.2 1.8" />
          </svg>
        </span>
        <span className="clock-copy">
          <strong>{triggerText}</strong>
          {selfActive && <small>{elapsed(selfActive.clockIn)}</small>}
        </span>
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal((
        <div
          className="clock-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="clock-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clock-title"
            tabIndex={-1}
          >
            <div className="clock-modal-head">
              <div>
                <div className="clock-kicker">Success Tutoring</div>
                <h2 id="clock-title">Time Clock</h2>
              </div>
              <button
                type="button"
                className="clock-close"
                onClick={() => setOpen(false)}
                disabled={busy}
                aria-label="Close Time Clock"
              >
                ×
              </button>
            </div>

            {state.error && <div className="clock-alert error">{state.error}</div>}
            {!state.config?.sheets && (
              <div className="clock-alert error">
                Google Sheets storage is not configured yet. An admin needs to finish the
                Time Clock setup.
              </div>
            )}
            {state.config?.sheets && !state.config?.geofence && (
              <div className="clock-alert warn">
                {state.config.geofenceError ||
                  'The centre location is not configured. Normal clocking is disabled.'}
              </div>
            )}

            <label className="clock-label" htmlFor="clock-team-member">
              Team member
            </label>
            {state.isAdmin ? (
              <select
                id="clock-team-member"
                className="input clock-input"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setError('');
                  setMessage('');
                  setLocationPhase('idle');
                  pendingRequest.current = null;
                }}
              >
                {(state.tutors || []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {name.toLowerCase() === String(state.tutor || '').toLowerCase()
                      ? ' (You)'
                      : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div id="clock-team-member" className="clock-person">
                {state.tutor || 'Signed-in tutor'}
              </div>
            )}

            <div className={`clock-status ${activeForTarget ? 'on' : 'off'}`}>
              <span className="status-dot" aria-hidden="true" />
              <div>
                <strong>
                  {activeForTarget ? 'Currently clocked in' : 'Ready to clock in'}
                </strong>
                <div>
                  {activeForTarget
                    ? `Started ${formatTime(activeForTarget.clockIn)} · ${elapsed(activeForTarget.clockIn)}`
                    : 'Location will be checked only when you continue.'}
                </div>
              </div>
            </div>

            <label className="clock-label" htmlFor="clock-notes">
              Notes <span>(optional)</span>
            </label>
            <textarea
              id="clock-notes"
              className="input clock-input clock-notes"
              maxLength={1_000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={
                activeForTarget
                  ? 'Anything the admin should know about this clock-out?'
                  : 'Anything the admin should know about this clock-in?'
              }
            />

            {state.isAdmin && (
              <div className="clock-admin-box">
                <label className="clock-check">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(event) => {
                      setOverride(event.target.checked);
                      setError('');
                      pendingRequest.current = null;
                    }}
                  />
                  <span>
                    <strong>Admin location override</strong>
                    <small>
                      Use only when location cannot be verified. Your admin name and reason
                      are permanently recorded.
                    </small>
                  </span>
                </label>
                {override && (
                  <>
                    <label className="clock-label" htmlFor="override-reason">
                      Override reason <span>(required)</span>
                    </label>
                    <textarea
                      id="override-reason"
                      className="input clock-input clock-override-reason"
                      maxLength={500}
                      value={overrideReason}
                      onChange={(event) => {
                        setOverrideReason(event.target.value);
                        if (error) setError('');
                      }}
                      aria-invalid={override && !!error && !hasWrittenOverrideReason(overrideReason)}
                      placeholder="e.g. Tutor's phone could not acquire GPS; I verified they are at the centre."
                    />
                  </>
                )}
              </div>
            )}

            {!override && (
              <div className={`clock-location ${locationPhase}`} aria-live="polite">
                <span aria-hidden="true">⌖</span>
                <div>
                  <strong>
                    {locationPhase === 'requesting'
                      ? 'Getting your location…'
                      : locationPhase === 'verifying'
                        ? 'Verifying with the centre…'
                        : locationPhase === 'verified'
                          ? 'Location verified'
                          : 'Location verification'}
                  </strong>
                  <small>
                    {locationDetail ||
                      `You must be within ${state.config?.radiusM || 150} m of the centre. There is no continuous tracking.`}
                  </small>
                </div>
              </div>
            )}
            {override && locationDetail && (
              <div className="clock-location">{locationDetail}</div>
            )}
            {message && (
              <div className="clock-alert success" role="status">
                ✓ {message}
              </div>
            )}
            {error && (
              <div className="clock-alert error" role="alert">
                {error}
              </div>
            )}
            <div className="clock-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn-primary clock-main-action ${activeForTarget ? 'clock-out' : ''}`}
                onClick={act}
                disabled={actionDisabled}
              >
                {busy
                  ? locationPhase === 'requesting'
                    ? 'Getting location…'
                    : 'Saving…'
                  : activeForTarget
                    ? `Clock Out${target !== state.tutor ? ` ${target}` : ''}`
                    : `Clock In${target !== state.tutor ? ` ${target}` : ''}`}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      <style jsx>{`
        .time-clock-trigger{display:flex;align-items:center;gap:.5rem;flex:0 0 auto;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.055);color:#e9eef6;border-radius:999px;padding:.4rem .72rem .4rem .46rem;cursor:pointer;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);transition:background .18s ease,border-color .18s ease,transform .18s ease}.time-clock-trigger:hover{background:rgba(255,255,255,.1);transform:translateY(-1px)}.time-clock-trigger:focus-visible{outline:2px solid #31c8ff;outline-offset:2px}.time-clock-trigger.is-active{border-color:rgba(52,211,153,.42);background:rgba(16,185,129,.1)}
        .clock-symbol{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(49,200,255,.13);color:#7cddfb}.clock-symbol svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.is-active .clock-symbol{background:rgba(52,211,153,.18);color:#86efac}.clock-copy{display:flex;flex-direction:column;align-items:flex-start;line-height:1.03}.clock-copy strong{font-size:.78rem;font-weight:720}.clock-copy small{font-size:.65rem;color:#91a0b5;margin-top:.16rem}
        .clock-modal-backdrop{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.74);backdrop-filter:blur(8px);display:grid;place-items:center;padding:1rem}.clock-modal{width:min(560px,100%);max-height:calc(100dvh - 2rem);overflow:auto;border-radius:24px;border:1px solid rgba(255,255,255,.13);background:radial-gradient(600px 250px at 50% 0%,rgba(49,200,255,.08),transparent 65%),#0b0d12;box-shadow:0 30px 100px rgba(0,0,0,.65);padding:1.25rem}.clock-modal-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:1rem;margin-bottom:1rem}.clock-modal-head h2{font-size:1.55rem;margin:.08rem 0 0;letter-spacing:-.04em}.clock-kicker{text-transform:uppercase;letter-spacing:.13em;font-size:.66rem;color:#8d9aad;font-weight:700}.clock-close{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#dce3ed;width:36px;height:36px;border-radius:50%;font-size:1.3rem;cursor:pointer}
        .clock-label{display:block;font-size:.78rem;font-weight:680;color:#cbd5e1;margin:.75rem 0 .38rem}.clock-label span{font-weight:450;color:#7f8b9d}.clock-input{width:100%}.clock-notes{min-height:74px!important;resize:vertical}.clock-override-reason{min-height:70px!important}.clock-person{padding:.72rem .82rem;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.035);border-radius:12px;font-weight:650}
        .clock-status{display:flex;gap:.7rem;align-items:center;margin:1rem 0;padding:.8rem;border-radius:15px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035)}.clock-status.on{border-color:rgba(52,211,153,.24);background:rgba(16,185,129,.06)}.status-dot{width:10px;height:10px;border-radius:50%;background:#657084;box-shadow:0 0 0 5px rgba(101,112,132,.1)}.on .status-dot{background:#34d399;box-shadow:0 0 0 5px rgba(52,211,153,.1)}.clock-status strong{font-size:.88rem}.clock-status div div{font-size:.74rem;color:#91a0b5;margin-top:.1rem}
        .clock-location,.clock-check{display:flex;gap:.7rem;align-items:flex-start}.clock-location{margin-top:1rem;padding:.8rem;border:1px solid rgba(49,200,255,.14);border-radius:14px;background:rgba(49,200,255,.045);font-size:.75rem;color:#aab5c5}.clock-location.verified{border-color:rgba(52,211,153,.25);background:rgba(52,211,153,.06)}.clock-location.error{border-color:rgba(239,68,68,.2)}.clock-location>span{font-size:1.2rem;color:#62d8ff}.clock-location strong,.clock-check strong{font-size:.8rem;display:block;color:#dce4ee}.clock-location small,.clock-check small{display:block;color:#8f9bae;font-size:.7rem;line-height:1.4;margin-top:.15rem}.clock-admin-box{margin-top:1rem;padding:.8rem;border:1px solid rgba(255,170,75,.15);border-radius:14px;background:rgba(255,137,28,.04)}.clock-check{cursor:pointer}.clock-check input{margin-top:.15rem;accent-color:#ff8b2b}
        .clock-alert{margin-top:.8rem;padding:.72rem .8rem;border-radius:12px;font-size:.78rem;border:1px solid}.clock-alert.success{color:#bbf7d0;background:rgba(34,197,94,.09);border-color:rgba(34,197,94,.25)}.clock-alert.error{color:#fecaca;background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.25)}.clock-alert.warn{color:#fde68a;background:rgba(245,158,11,.07);border-color:rgba(245,158,11,.22)}
        .clock-actions{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1.1rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.08)}.clock-main-action{min-width:160px}.clock-main-action:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none}.clock-main-action.clock-out{background:linear-gradient(135deg,#fb7185,#ef4444)!important;color:white!important}
        @media(max-width:560px){.clock-copy small{display:none}.time-clock-trigger{padding-right:.55rem}.clock-modal-backdrop{padding:.5rem}.clock-modal{max-height:calc(100dvh - 1rem);border-radius:20px;padding:1rem}.clock-actions{position:sticky;bottom:-1rem;background:#0b0d12;padding-bottom:.8rem}.clock-actions .btn,.clock-actions .btn-primary{flex:1;min-height:44px}.clock-main-action{min-width:0}}
      `}</style>
    </>
  );
}
