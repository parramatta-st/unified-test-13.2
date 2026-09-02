import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../components/Header';
import useAuthGuard from '../../hooks/useAuthGuard';

type Shift = {
  shiftId: string;
  tutorId: string;
  tutorName: string;
  clockIn: string;
  clockOut: string;
  normalHours: number;
  after7Hours: number;
  saturdayHours: number;
  unclassifiedHours: number;
  elapsedHours: number;
  rangeNormalHours: number;
  rangeAfter7Hours: number;
  rangeSaturdayHours: number;
  rangeUnclassifiedHours: number;
  rangeElapsedHours: number;
  rangeClipped: boolean;
  status: 'active' | 'completed' | 'voided';
  version: number;
  edited: boolean;
  editCount: number;
  manual: boolean;
  reviewFlags: string[];
  clockInBy: string;
  clockOutBy: string;
  clockInPerformedAs: string;
  clockOutPerformedAs: string;
  clockInNotes: string;
  clockOutNotes: string;
  clockInLocationVerified: boolean;
  clockOutLocationVerified: boolean;
  clockInAdminOverride: boolean;
  clockOutAdminOverride: boolean;
  clockInOverrideReason: string;
  clockOutOverrideReason: string;
  clockInDistanceM: string;
  clockOutDistanceM: string;
  clockInAccuracy: string;
  clockOutAccuracy: string;
  voidedAt: string;
  voidedBy: string;
  voidReason: string;
};

type Summary = {
  tutorId: string;
  tutorName: string;
  shifts: number;
  normalHours: number;
  after7Hours: number;
  saturdayHours: number;
  unclassifiedHours: number;
  totalHours: number;
  reviewCount: number;
};

type Adjustment = {
  adjustmentId: string;
  shiftId: string;
  action: 'created' | 'edited' | 'voided';
  changedAt: string;
  changedBy: string;
  reason: string;
  oldClockIn: string;
  newClockIn: string;
  oldClockOut: string;
  newClockOut: string;
  oldStatus: string;
  newStatus: string;
};

type EditMode = 'create' | 'edit' | 'void' | '';

function dateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function formatDate(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDateTime(value: string) {
  if (!value) return '—';
  return `${formatDate(value)} at ${formatTime(value)}`;
}

function formatHours(value: unknown) {
  const number = Number(value || 0);
  return number ? `${number.toFixed(2)} h` : '—';
}

function localInput(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `admin_${crypto.randomUUID()}`;
  }
  return `admin_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const reviewLabels: Record<string, string> = {
  invalid_timestamps: 'Invalid timestamps',
  future_clock_in: 'Future clock-in',
  open_over_limit: 'Long open shift',
  long_shift: 'Long shift',
  sunday_unclassified: 'Sunday hours',
  clock_in_location_override: 'Clock-in override',
  clock_out_location_override: 'Clock-out override',
  clock_in_location_unverified: 'Clock-in location unverified',
  clock_out_location_unverified: 'Clock-out location unverified',
  manual_shift: 'Manual shift',
  overlapping_shift: 'Overlapping shift',
};

export default function TimeClockAdmin() {
  useAuthGuard();
  const today = dateKey(new Date());
  const [from, setFrom] = useState(addDays(today, -13));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Shift[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [tutors, setTutors] = useState<string[]>([]);
  const [config, setConfig] = useState<any>({});
  const [integrityWarnings, setIntegrityWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filterTutor, setFilterTutor] = useState('');
  const [expandedShift, setExpandedShift] = useState('');
  const [mode, setMode] = useState<EditMode>('');
  const [editing, setEditing] = useState<Shift | null>(null);
  const [formTutor, setFormTutor] = useState('');
  const [formClockIn, setFormClockIn] = useState('');
  const [formClockOut, setFormClockOut] = useState('');
  const [formReason, setFormReason] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const pendingMutation = useRef<string>('');
  const loadSequence = useRef(0);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/time-clock?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: 'no-store' },
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Could not load Time Clock payroll.');
      }
      if (sequence !== loadSequence.current) return;
      setRows(json.rows || []);
      setSummary(json.summary || []);
      setAdjustments(json.adjustments || []);
      setTutors(json.tutors || []);
      setConfig(json.config || {});
      setIntegrityWarnings(json.integrityWarnings || []);
    } catch (loadError: any) {
      if (sequence === loadSequence.current) {
        setError(loadError?.message || 'Could not load Time Clock payroll.');
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [from, to]);

  const visibleRows = useMemo(
    () =>
      filterTutor
        ? rows.filter((row) => row.tutorName === filterTutor)
        : rows,
    [rows, filterTutor],
  );
  const visibleSummary = useMemo(
    () =>
      filterTutor
        ? summary.filter((row) => row.tutorName === filterTutor)
        : summary,
    [summary, filterTutor],
  );
  const auditByShift = useMemo(() => {
    const map = new Map<string, Adjustment[]>();
    for (const adjustment of adjustments) {
      const list = map.get(adjustment.shiftId) || [];
      list.push(adjustment);
      map.set(adjustment.shiftId, list);
    }
    return map;
  }, [adjustments]);

  function currentFortnight() {
    const currentToday = dateKey(new Date());
    setFrom(addDays(currentToday, -13));
    setTo(currentToday);
  }

  function shiftFortnight(direction: number) {
    setFrom(addDays(from, direction * 14));
    setTo(addDays(to, direction * 14));
  }

  function openCreate() {
    setMode('create');
    setEditing(null);
    setFormTutor(filterTutor || tutors[0] || '');
    setFormClockIn('');
    setFormClockOut('');
    setFormReason('');
    setFormNotes('');
    setError('');
    pendingMutation.current = '';
  }

  function openEdit(shift: Shift) {
    setMode('edit');
    setEditing(shift);
    setFormTutor(shift.tutorName);
    setFormClockIn(localInput(shift.clockIn));
    setFormClockOut(localInput(shift.clockOut));
    setFormReason('');
    setFormNotes('');
    setError('');
    pendingMutation.current = '';
  }

  function openVoid(shift: Shift) {
    setMode('void');
    setEditing(shift);
    setFormTutor(shift.tutorName);
    setFormClockIn('');
    setFormClockOut('');
    setFormReason('');
    setFormNotes('');
    setError('');
    pendingMutation.current = '';
  }

  function closeModal() {
    if (saving) return;
    setMode('');
    setEditing(null);
    pendingMutation.current = '';
  }

  async function saveChange() {
    if (!mode || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    if (!pendingMutation.current) pendingMutation.current = newRequestId();
    try {
      const action =
        mode === 'create'
          ? 'create_shift'
          : mode === 'edit'
            ? 'edit_shift'
            : 'void_shift';
      // Preserve an existing unambiguous ISO instant when its displayed wall
      // time was not changed. This matters during the repeated DST hour.
      const clockIn =
        mode === 'edit' && editing && formClockIn === localInput(editing.clockIn)
          ? editing.clockIn
          : formClockIn;
      const clockOut =
        mode === 'edit' &&
        editing?.clockOut &&
        formClockOut === localInput(editing.clockOut)
          ? editing.clockOut
          : formClockOut;
      const response = await fetch('/api/admin/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          requestId: pendingMutation.current,
          shiftId: editing?.shiftId || '',
          version: editing?.version || '',
          tutorName: formTutor,
          clockIn,
          clockOut,
          reason: formReason,
          notes: formNotes,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        const mutationError: any = new Error(
          json?.error || 'Could not save the Time Clock change.',
        );
        mutationError.status = response.status;
        throw mutationError;
      }
      pendingMutation.current = '';
      setSuccess(json.message || 'Time Clock updated.');
      setMode('');
      setEditing(null);
      await load();
    } catch (mutationError: any) {
      if (mutationError?.status && mutationError.status < 500) {
        pendingMutation.current = '';
      }
      setError(mutationError?.message || 'Could not save the Time Clock change.');
      if (mutationError?.status === 409) await load();
    } finally {
      setSaving(false);
    }
  }

  function exportPayroll() {
    const headers = [
      'Tutor',
      'Normal Hours',
      'After 7 PM Hours',
      'Saturday Hours',
      'Sunday / Unclassified Hours',
      'Completed Shifts',
      'Review Flags',
    ];
    const lines = [
      headers.map(csvCell).join(','),
      ...visibleSummary.map((row) =>
        [
          row.tutorName,
          row.normalHours.toFixed(2),
          row.after7Hours.toFixed(2),
          row.saturdayHours.toFixed(2),
          row.unclassifiedHours.toFixed(2),
          row.shifts,
          row.reviewCount,
        ]
          .map(csvCell)
          .join(','),
      ),
    ];
    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `time-clock-payroll-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const formReady =
    formReason.trim().length >= 8 &&
    (mode === 'void' || (!!formClockIn && (mode !== 'create' || !!formTutor)));

  return (
    <div>
      <Header />
      <main className="container tc-admin-page">
        <section className="card tc-hero">
          <div className="tc-title-row">
            <div>
              <div className="eyebrow">Payroll</div>
              <h1 className="section-title">Time Clock</h1>
              <p className="text-muted">
                Review every shift and export Normal, After 7 PM, and Saturday hours
                separately.
              </p>
            </div>
            <div className="tc-top-actions">
              <button className="btn" onClick={openCreate} disabled={!config.sheets}>
                + Add missed shift
              </button>
              <button className="btn" onClick={load} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {!config.sheets && !loading && (
            <div className="tc-banner error">
              {!config.credentials
                ? 'Google service-account credentials are not available to Time Clock.'
                : 'Add TIME_CLOCK_SPREADSHEET_ID or GOOGLE_SHEETS_SPREADSHEET_ID to enable storage.'}
            </div>
          )}
          {config.sheets && !config.geofence && (
            <div className="tc-banner warn">
              Storage is ready, but normal clocking is disabled until the centre latitude
              and longitude are configured.
            </div>
          )}
          {integrityWarnings.length > 0 && (
            <div className="tc-banner error">
              <strong>{integrityWarnings.length} event integrity warning(s).</strong>{' '}
              Payroll excludes altered or incomplete event rows. Inspect the event ledger
              before processing pay.
            </div>
          )}
          {success && <div className="tc-banner success">✓ {success}</div>}
          {error && <div className="tc-banner error">{error}</div>}

          <div className="tc-filterbar">
            <button className="btn" onClick={() => shiftFortnight(-1)}>
              ‹ Previous fortnight
            </button>
            <label>
              <span>From</span>
              <input
                className="input"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              <span>To</span>
              <input
                className="input"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <label>
              <span>Team member</span>
              <select
                className="input"
                value={filterTutor}
                onChange={(event) => setFilterTutor(event.target.value)}
              >
                <option value="">All tutors</option>
                {tutors.map((tutor) => (
                  <option key={tutor}>{tutor}</option>
                ))}
              </select>
            </label>
            <div className="tc-range-actions">
              <button className="btn" onClick={currentFortnight}>
                Current 14 days
              </button>
              <button className="btn" onClick={() => shiftFortnight(1)}>
                Next fortnight ›
              </button>
            </div>
          </div>
          <div className="tc-range-label">
            Selected payroll range: <strong>{from}</strong> to <strong>{to}</strong>,
            inclusive (Australia/Sydney)
          </div>
        </section>

        <section className="card mt-4">
          <div className="tc-section-head">
            <div>
              <h2 className="section-title tc-small-title">Payroll summary</h2>
              <p className="text-muted text-sm">
                The three main categories are mutually exclusive. Saturday always takes
                priority over After 7 PM.
              </p>
            </div>
            <button
              className="btn"
              onClick={exportPayroll}
              disabled={!visibleSummary.length}
            >
              Export CSV
            </button>
          </div>
          <div className="tc-summary-wrap">
            <table className="tc-summary-table">
              <thead>
                <tr>
                  <th>Tutor</th>
                  <th>Normal hours</th>
                  <th>After 7 PM</th>
                  <th>Saturday</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {visibleSummary.map((row) => (
                  <tr
                    key={row.tutorId || row.tutorName}
                    onClick={() => setFilterTutor(row.tutorName)}
                    title={`Show ${row.tutorName}'s shifts`}
                  >
                    <td>
                      <strong>{row.tutorName}</strong>
                      <small>{row.shifts} completed shift{row.shifts === 1 ? '' : 's'}</small>
                    </td>
                    <td className="tc-hours normal">{row.normalHours.toFixed(2)}</td>
                    <td className="tc-hours after">{row.after7Hours.toFixed(2)}</td>
                    <td className="tc-hours saturday">{row.saturdayHours.toFixed(2)}</td>
                    <td>
                      {row.unclassifiedHours > 0 ? (
                        <span className="tc-review-badge danger">
                          {row.unclassifiedHours.toFixed(2)} h Sunday
                        </span>
                      ) : row.reviewCount ? (
                        <span className="tc-review-badge">{row.reviewCount} flagged</span>
                      ) : (
                        <span className="tc-clear">Clear</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleSummary.length && !loading && (
              <div className="tc-empty">No completed shifts in this date range.</div>
            )}
          </div>
        </section>

        <section className="card mt-4">
          <div className="tc-section-head">
            <div>
              <h2 className="section-title tc-small-title">Shift detail</h2>
              <p className="text-muted text-sm">
                Hours below are clipped to the selected range. Expand a row for location,
                notes, flags, and full adjustment history.
              </p>
            </div>
            <span className="tc-count">
              {visibleRows.length} shift{visibleRows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="tc-table-wrap">
            <table className="tc-table">
              <thead>
                <tr>
                  <th>Tutor</th>
                  <th>Date</th>
                  <th>Clock in</th>
                  <th>Clock out</th>
                  <th>Normal</th>
                  <th>After 7 PM</th>
                  <th>Saturday</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const audit = auditByShift.get(row.shiftId) || [];
                  const expanded = expandedShift === row.shiftId;
                  return (
                    <Fragment key={row.shiftId}>
                      <tr className={row.status === 'voided' ? 'is-voided' : ''}>
                        <td>
                          <strong>{row.tutorName}</strong>
                          <div className="tc-inline-badges">
                            {row.edited && <span className="tc-edited">Adjusted</span>}
                            {row.rangeClipped && <span className="tc-clipped">Range split</span>}
                          </div>
                        </td>
                        <td>{formatDate(row.clockIn)}</td>
                        <td>
                          {formatTime(row.clockIn)}
                          {row.clockInBy && row.clockInBy !== row.tutorName && (
                            <small>by {row.clockInBy}</small>
                          )}
                        </td>
                        <td>
                          {formatTime(row.clockOut)}
                          {row.clockOutBy && row.clockOutBy !== row.tutorName && (
                            <small>by {row.clockOutBy}</small>
                          )}
                        </td>
                        <td>{formatHours(row.rangeNormalHours)}</td>
                        <td>{formatHours(row.rangeAfter7Hours)}</td>
                        <td>{formatHours(row.rangeSaturdayHours)}</td>
                        <td>
                          <span className={`tc-status ${row.status}`}>
                            {row.status === 'active'
                              ? 'Clocked in'
                              : row.status === 'voided'
                                ? 'Voided'
                                : 'Completed'}
                          </span>
                          {!!row.reviewFlags?.length && (
                            <small className="tc-needs-review">Needs review</small>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn tc-details"
                            onClick={() => setExpandedShift(expanded ? '' : row.shiftId)}
                          >
                            {expanded ? 'Hide' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="tc-detail-row">
                          <td colSpan={9}>
                            <div className="tc-detail-panel">
                              <div className="tc-detail-grid">
                                <div>
                                  <span>Clock in audit</span>
                                  <strong>
                                    {row.clockInLocationVerified
                                      ? '✓ Location verified'
                                      : row.clockInAdminOverride
                                        ? 'Admin override'
                                        : 'Location not verified'}
                                  </strong>
                                  <small>
                                    {row.clockInDistanceM
                                      ? `${Math.round(Number(row.clockInDistanceM))} m from centre`
                                      : 'No distance recorded'}
                                    {row.clockInAccuracy
                                      ? ` · ±${Math.round(Number(row.clockInAccuracy))} m accuracy`
                                      : ''}
                                  </small>
                                  {row.clockInOverrideReason && (
                                    <em>{row.clockInOverrideReason}</em>
                                  )}
                                </div>
                                <div>
                                  <span>Clock out audit</span>
                                  <strong>
                                    {!row.clockOut
                                      ? 'Still open'
                                      : row.clockOutLocationVerified
                                        ? '✓ Location verified'
                                        : row.clockOutAdminOverride
                                          ? 'Admin override'
                                          : 'Location not verified'}
                                  </strong>
                                  <small>
                                    {row.clockOutDistanceM
                                      ? `${Math.round(Number(row.clockOutDistanceM))} m from centre`
                                      : row.clockOut
                                        ? 'No distance recorded'
                                        : '—'}
                                    {row.clockOutAccuracy
                                      ? ` · ±${Math.round(Number(row.clockOutAccuracy))} m accuracy`
                                      : ''}
                                  </small>
                                  {row.clockOutOverrideReason && (
                                    <em>{row.clockOutOverrideReason}</em>
                                  )}
                                </div>
                                <div>
                                  <span>Full shift hours</span>
                                  <strong>
                                    {row.normalHours.toFixed(2)} normal ·{' '}
                                    {row.after7Hours.toFixed(2)} after 7 ·{' '}
                                    {row.saturdayHours.toFixed(2)} Saturday
                                  </strong>
                                  <small>{row.elapsedHours.toFixed(2)} total elapsed hours</small>
                                </div>
                              </div>

                              {(row.clockInNotes || row.clockOutNotes) && (
                                <div className="tc-notes">
                                  {row.clockInNotes && (
                                    <div><strong>Clock-in note:</strong> {row.clockInNotes}</div>
                                  )}
                                  {row.clockOutNotes && (
                                    <div><strong>Clock-out note:</strong> {row.clockOutNotes}</div>
                                  )}
                                </div>
                              )}

                              {!!row.reviewFlags?.length && (
                                <div className="tc-flags">
                                  {row.reviewFlags.map((flag) => (
                                    <span key={flag}>{reviewLabels[flag] || flag}</span>
                                  ))}
                                </div>
                              )}

                              <div className="tc-audit-history">
                                <h3>Adjustment history</h3>
                                {audit.length ? (
                                  audit.map((entry) => (
                                    <article key={entry.adjustmentId}>
                                      <div>
                                        <strong>{entry.action}</strong> by {entry.changedBy} ·{' '}
                                        {formatDateTime(entry.changedAt)}
                                      </div>
                                      <p>{entry.reason}</p>
                                      <small>
                                        Clock in: {formatDateTime(entry.oldClockIn)} →{' '}
                                        {formatDateTime(entry.newClockIn)}<br />
                                        Clock out: {formatDateTime(entry.oldClockOut)} →{' '}
                                        {formatDateTime(entry.newClockOut)}
                                      </small>
                                    </article>
                                  ))
                                ) : (
                                  <p className="text-muted text-sm">No admin adjustments.</p>
                                )}
                              </div>

                              <div className="tc-detail-actions">
                                {row.status !== 'voided' && (
                                  <>
                                    <button className="btn" onClick={() => openEdit(row)}>
                                      Edit times
                                    </button>
                                    <button
                                      className="btn tc-void-button"
                                      onClick={() => openVoid(row)}
                                    >
                                      Void duplicate/error
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {!visibleRows.length && !loading && (
              <div className="tc-empty">No shifts found for this range.</div>
            )}
          </div>
        </section>

        {mode && (
          <div
            className="tc-modal-bg"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeModal();
            }}
          >
            <div
              className="tc-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tc-modal-title"
            >
              <div className="tc-modal-head">
                <div>
                  <div className="eyebrow">Admin audit action</div>
                  <h2 id="tc-modal-title">
                    {mode === 'create'
                      ? 'Add a missed shift'
                      : mode === 'edit'
                        ? `Edit ${editing?.tutorName}'s shift`
                        : `Void ${editing?.tutorName}'s shift`}
                  </h2>
                </div>
                <button className="tc-x" onClick={closeModal} aria-label="Close" disabled={saving}>
                  ×
                </button>
              </div>

              {mode === 'create' && (
                <label className="tc-field">
                  <span>Team member</span>
                  <select
                    className="input"
                    value={formTutor}
                    onChange={(event) => setFormTutor(event.target.value)}
                  >
                    {tutors.map((tutor) => (
                      <option key={tutor}>{tutor}</option>
                    ))}
                  </select>
                </label>
              )}

              {mode !== 'void' && (
                <div className="tc-edit-grid">
                  <label className="tc-field">
                    <span>Clock in (Sydney time)</span>
                    <input
                      className="input"
                      type="datetime-local"
                      step="60"
                      value={formClockIn}
                      onChange={(event) => setFormClockIn(event.target.value)}
                    />
                  </label>
                  <label className="tc-field">
                    <span>Clock out (optional for an open shift)</span>
                    <input
                      className="input"
                      type="datetime-local"
                      step="60"
                      value={formClockOut}
                      onChange={(event) => setFormClockOut(event.target.value)}
                    />
                  </label>
                </div>
              )}

              {mode === 'create' && (
                <label className="tc-field">
                  <span>Notes (optional)</span>
                  <textarea
                    className="input tc-form-notes"
                    maxLength={1_000}
                    value={formNotes}
                    onChange={(event) => setFormNotes(event.target.value)}
                    placeholder="Any useful context about the missed shift."
                  />
                </label>
              )}

              <label className="tc-field">
                <span>
                  Reason <b>required</b>
                </span>
                <textarea
                  className="input tc-form-reason"
                  maxLength={1_000}
                  value={formReason}
                  onChange={(event) => setFormReason(event.target.value)}
                  placeholder={
                    mode === 'void'
                      ? 'e.g. Duplicate shift created after the tutor tapped Clock In twice.'
                      : 'e.g. Tutor forgot to clock in on arrival; confirmed their actual start was 4:00 PM.'
                  }
                />
              </label>

              <div className="tc-audit-note">
                {mode === 'void'
                  ? 'The shift will remain visible as Voided. It is never deleted and contributes no payroll hours.'
                  : 'The original values, your admin identity, the time of this change, and this reason are retained in the audit ledger.'}
              </div>
              <div className="tc-modal-actions">
                <button className="btn" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button
                  className={`btn-primary ${mode === 'void' ? 'tc-danger-action' : ''}`}
                  onClick={saveChange}
                  disabled={saving || !formReady}
                >
                  {saving
                    ? 'Saving…'
                    : mode === 'create'
                      ? 'Create audited shift'
                      : mode === 'edit'
                        ? 'Save corrected shift'
                        : 'Void shift'}
                </button>
              </div>
            </div>
          </div>
        )}

        <style jsx>{`
          .tc-admin-page{padding-bottom:4rem}.tc-title-row,.tc-section-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.tc-title-row .section-title{margin:.25rem 0 .35rem}.tc-title-row p{margin:0}.tc-top-actions,.tc-range-actions{display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end}.tc-small-title{font-size:1.35rem!important;margin:0 0 .3rem}.tc-filterbar{display:grid;grid-template-columns:auto 1fr 1fr minmax(170px,1fr) auto;gap:.65rem;align-items:end;margin-top:1.2rem}.tc-filterbar label>span,.tc-field>span{display:block;font-size:.72rem;color:#9ca8ba;font-weight:650;margin-bottom:.32rem}.tc-range-actions{flex-wrap:nowrap}.tc-range-label{margin-top:.75rem;color:#8490a2;font-size:.72rem}.tc-banner{padding:.78rem .88rem;border-radius:13px;margin-top:.85rem;font-size:.8rem;border:1px solid}.tc-banner.error{color:#fecaca;background:rgba(239,68,68,.07);border-color:rgba(239,68,68,.24)}.tc-banner.warn{color:#fde68a;background:rgba(245,158,11,.07);border-color:rgba(245,158,11,.22)}.tc-banner.success{color:#bbf7d0;background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.24)}
          .tc-summary-wrap,.tc-table-wrap{overflow-x:auto;margin-top:.85rem;border:1px solid rgba(255,255,255,.07);border-radius:15px}.tc-summary-table,.tc-table{width:100%;border-collapse:collapse}.tc-summary-table{min-width:720px}.tc-summary-table th,.tc-table th{text-align:left;font-size:.66rem;text-transform:uppercase;letter-spacing:.08em;color:#778497;padding:.65rem .7rem;border-bottom:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.018)}.tc-summary-table td{padding:.82rem .7rem;border-bottom:1px solid rgba(255,255,255,.065);font-size:.8rem}.tc-summary-table tbody tr{cursor:pointer;transition:background .15s ease}.tc-summary-table tbody tr:hover{background:rgba(255,255,255,.035)}.tc-summary-table td small{display:block;color:#778497;font-size:.65rem;margin-top:.16rem}.tc-hours{font-size:1.08rem!important;font-variant-numeric:tabular-nums;font-weight:780}.tc-hours.normal{color:#e6edf7}.tc-hours.after{color:#7dd3fc}.tc-hours.saturday{color:#fdba74}.tc-review-badge{display:inline-block;font-size:.62rem;padding:.25rem .45rem;border-radius:999px;color:#fde68a;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.22)}.tc-review-badge.danger{color:#fecaca;background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.23)}.tc-clear{color:#86efac;font-size:.7rem}
          .tc-count{font-size:.72rem;color:#8d99a9;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:.35rem .6rem}.tc-table{min-width:1060px}.tc-table td{padding:.72rem .62rem;border-bottom:1px solid rgba(255,255,255,.065);font-size:.78rem;vertical-align:middle}.tc-table td small{display:block;color:#778497;font-size:.62rem;margin-top:.12rem}.tc-table tr.is-voided>td{opacity:.57;text-decoration-color:#ef4444}.tc-inline-badges{display:flex;gap:.25rem;margin-top:.2rem}.tc-edited,.tc-clipped{display:inline-block;font-size:.56rem;padding:.14rem .32rem;border-radius:999px}.tc-edited{background:rgba(245,158,11,.12);color:#fcd34d}.tc-clipped{background:rgba(49,200,255,.1);color:#7dd3fc}.tc-status{display:inline-block;font-size:.64rem;padding:.26rem .45rem;border-radius:999px;border:1px solid rgba(255,255,255,.1)}.tc-status.active{color:#86efac;border-color:rgba(52,211,153,.25);background:rgba(52,211,153,.06)}.tc-status.voided{color:#fca5a5;border-color:rgba(239,68,68,.23);background:rgba(239,68,68,.06)}.tc-needs-review{color:#fbbf24!important}.tc-details{padding:.36rem .58rem!important;font-size:.68rem!important}.tc-empty{text-align:center;color:#8793a5;padding:2rem}
          .tc-detail-row td{padding:0!important;background:rgba(0,0,0,.2)}.tc-detail-panel{padding:1rem 1.1rem}.tc-detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem}.tc-detail-grid>div{border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.025);border-radius:13px;padding:.72rem}.tc-detail-grid span{display:block;color:#7f8b9b;font-size:.64rem;text-transform:uppercase;letter-spacing:.06em}.tc-detail-grid strong{display:block;font-size:.75rem;margin-top:.28rem}.tc-detail-grid small,.tc-detail-grid em{display:block;color:#8f9aac;font-size:.65rem;line-height:1.4;margin-top:.18rem}.tc-detail-grid em{color:#fcd34d}.tc-notes{margin-top:.7rem;padding:.7rem;border-radius:12px;background:rgba(255,255,255,.025);font-size:.72rem;color:#a9b4c3}.tc-notes>div+div{margin-top:.35rem}.tc-flags{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.7rem}.tc-flags span{font-size:.62rem;color:#fde68a;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.18);padding:.26rem .42rem;border-radius:999px}.tc-audit-history{margin-top:.85rem}.tc-audit-history h3{font-size:.8rem;margin:0 0 .45rem}.tc-audit-history article{border-left:2px solid rgba(49,200,255,.32);padding:.48rem .65rem;margin:.4rem 0;background:rgba(49,200,255,.025);border-radius:0 10px 10px 0;font-size:.7rem}.tc-audit-history article p{margin:.25rem 0;color:#c4ceda}.tc-audit-history article small{color:#7f8b9b;line-height:1.5}.tc-detail-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.8rem}.tc-void-button{color:#fca5a5!important;border-color:rgba(239,68,68,.2)!important}
          .tc-modal-bg{position:fixed;inset:0;z-index:5100;background:rgba(0,0,0,.76);backdrop-filter:blur(8px);display:grid;place-items:center;padding:1rem}.tc-modal{width:min(650px,100%);max-height:calc(100dvh - 2rem);overflow:auto;background:#0b0d12;border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:1.2rem;box-shadow:0 35px 100px rgba(0,0,0,.7)}.tc-modal-head{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:.8rem;border-bottom:1px solid rgba(255,255,255,.08)}.tc-modal-head h2{margin:.2rem 0 0;font-size:1.35rem}.tc-x{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:white;font-size:1.2rem}.tc-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:1rem}.tc-field{display:block;margin-top:.85rem}.tc-field b{color:#fca5a5}.tc-form-reason{min-height:92px!important}.tc-form-notes{min-height:70px!important}.tc-audit-note{font-size:.72rem;color:#98a5b6;padding:.72rem;margin-top:.75rem;border-radius:12px;background:rgba(49,200,255,.04);border:1px solid rgba(49,200,255,.12)}.tc-modal-actions{display:flex;justify-content:flex-end;gap:.6rem;padding-top:1rem;margin-top:1rem;border-top:1px solid rgba(255,255,255,.08)}.tc-danger-action{background:linear-gradient(135deg,#fb7185,#ef4444)!important;color:#fff!important}
          @media(max-width:980px){.tc-filterbar{grid-template-columns:1fr 1fr}.tc-filterbar>button:first-child{grid-column:1}.tc-filterbar label:nth-of-type(3){grid-column:1/-1}.tc-range-actions{justify-content:stretch}.tc-range-actions .btn{flex:1}.tc-detail-grid{grid-template-columns:1fr 1fr}}
          @media(max-width:600px){.tc-admin-page{padding-left:.7rem!important;padding-right:.7rem!important}.tc-title-row{align-items:flex-start}.tc-title-row,.tc-section-head{flex-direction:column}.tc-top-actions,.tc-section-head>.btn{width:100%}.tc-top-actions .btn,.tc-section-head>.btn{flex:1}.tc-filterbar{grid-template-columns:1fr 1fr}.tc-filterbar>button:first-child,.tc-range-actions{grid-column:1/-1}.tc-detail-grid{grid-template-columns:1fr}.tc-edit-grid{grid-template-columns:1fr}.tc-modal-bg{padding:.5rem}.tc-modal{max-height:calc(100dvh - 1rem);padding:1rem}.tc-modal-actions{position:sticky;bottom:-1rem;background:#0b0d12;padding-bottom:.8rem}.tc-modal-actions .btn,.tc-modal-actions .btn-primary{flex:1;min-height:44px}}
        `}</style>
      </main>
    </div>
  );
}
