import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import StudentPicker, { type StudentPickerValue } from '../components/StudentPicker';
import useAuthGuard from '../hooks/useAuthGuard';

type ProgressProgramStatus = 'in_progress' | 'completed' | 'moved_on_without_assessment';

type ProgressProgramEvent = {
  id: string;
  kind: 'lesson' | 'assessment';
  label: string;
  topic: string;
  tutorName: string;
  timestampIso: string;
  timestampLabel: string;
};

type ProgressProgram = {
  id: string;
  title: string;
  year: string;
  subject: string;
  status: ProgressProgramStatus;
  startedAt: string;
  lastActivityAt: string;
  eventCount: number;
  events: ProgressProgramEvent[];
};

type ProgressSubjectSection = { key: string; label: string; programs: ProgressProgram[] };

type ProgressResponse = {
  ok: boolean;
  error?: string;
  progress?: {
    student: { studentId: string; studentName: string; parentEmail: string };
    subjects: ProgressSubjectSection[];
    totalPrograms: number;
    totalEvents: number;
  };
};

type RecentPrint = {
  ms: number; timestamp: string; tutor: string; year: string; subject: string; topic: string; folder: string; names: string[]; ok: boolean;
};

const subjectDisplayOrder = ['English', 'Maths'];

function formatStatus(status: ProgressProgramStatus) {
  switch (status) {
    case 'completed': return 'Completed';
    case 'moved_on_without_assessment': return 'Moved On Without Assessment';
    default: return 'In Progress';
  }
}

function formatEventDate(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('/')) return trimmed.split(/\s+/)[0] || trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return trimmed;
  return new Intl.DateTimeFormat('en-AU', { day:'numeric', month:'short', year:'numeric', timeZone:'Australia/Sydney' }).format(new Date(parsed));
}

function formatAdminDate(value: string | number) {
  if (!value) return '';
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-AU', { day:'numeric', month:'short', hour:'numeric', minute:'2-digit', timeZone:'Australia/Sydney' }).format(d);
}

function buildOrderedSubjects(subjects: ProgressSubjectSection[]) {
  const byKey = new Map(subjects.map((subject) => [subject.label, subject]));
  const ordered: ProgressSubjectSection[] = [];
  for (const label of subjectDisplayOrder) {
    ordered.push(byKey.get(label) || { key: label.toLowerCase(), label, programs: [] });
    byKey.delete(label);
  }
  return ordered.concat([...byKey.values()].sort((a,b) => a.label.localeCompare(b.label)));
}

function lessonNumber(label: string) {
  const m = String(label || '').match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function latestEventMs(e: ProgressProgramEvent) {
  const ms = Date.parse(e.timestampIso || e.timestampLabel || '');
  return Number.isNaN(ms) ? 0 : ms;
}

function buildRecentFeedback(progress: ProgressResponse['progress'] | null) {
  const out: Array<ProgressProgramEvent & { programTitle:string; year:string; subject:string }> = [];
  for (const section of progress?.subjects || []) {
    for (const program of section.programs || []) {
      for (const event of program.events || []) {
        out.push({ ...event, programTitle: program.title, year: program.year, subject: program.subject });
      }
    }
  }
  return out.sort((a,b)=>latestEventMs(b)-latestEventMs(a)).slice(0,5);
}

function buildSuggestedNext(progress: ProgressResponse['progress'] | null) {
  const programs = (progress?.subjects || []).flatMap((s) => s.programs || []);
  if (!programs.length) return 'No logged progress yet. Start with the student’s current centre plan.';
  const incomplete = programs
    .filter((p) => p.status !== 'completed')
    .sort((a,b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  const target = incomplete[0] || programs.slice().sort((a,b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))[0];
  const lessonEvents = (target.events || []).filter(e => e.kind === 'lesson');
  const maxLesson = Math.max(0, ...lessonEvents.map(e => lessonNumber(e.label)));
  if (target.status !== 'completed' && maxLesson > 0 && maxLesson < 10) {
    return `${target.year} ${target.subject} — ${target.title} — Lesson ${maxLesson + 1}`;
  }
  if (target.status !== 'completed') return `${target.year} ${target.subject} — continue ${target.title}`;
  return `${target.year} ${target.subject} — ${target.title} is completed. Choose the next topic/year plan.`;
}

export default function ProgressPage() {
  useAuthGuard();

  const [student, setStudent] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentPickerValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<ProgressResponse['progress'] | null>(null);
  const [recentPrints, setRecentPrints] = useState<RecentPrint[]>([]);
  const [openPrograms, setOpenPrograms] = useState<Record<string, boolean>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState('');

  useEffect(() => {
    if (!selectedStudent) {
      setProgress(null); setRecentPrints([]); setError(''); setOpenPrograms({}); setLastRefreshedAt('');
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams();
    if (selectedStudent.id) params.set('studentId', selectedStudent.id);
    if (selectedStudent.name) params.set('studentName', selectedStudent.name);
    if (selectedStudent.email) params.set('parentEmail', selectedStudent.email);
    params.set('_cb', `${Date.now()}-${refreshKey}`);

    setLoading(true); setPrintLoading(true); setError('');

    fetch(`/api/student-progress?${params.toString()}`, { signal: controller.signal, cache:'no-store' })
      .then(async (response) => {
        const json = await response.json().catch(() => ({})) as ProgressResponse;
        if (!response.ok || !json.ok) throw new Error(json.error || 'Failed to load student progress.');
        setProgress(json.progress || null);
        setLastRefreshedAt(new Intl.DateTimeFormat('en-AU', { hour:'numeric', minute:'2-digit', second:'2-digit', timeZone:'Australia/Sydney' }).format(new Date()));
        setOpenPrograms({});
      })
      .catch((fetchError:any) => { if (fetchError?.name !== 'AbortError') { setProgress(null); setError(fetchError?.message || 'Failed to load student progress.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    fetch(`/api/student-print-history?${params.toString()}`, { signal: controller.signal, cache:'no-store' })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (response.ok && json?.ok) setRecentPrints(Array.isArray(json.prints) ? json.prints : []);
        else setRecentPrints([]);
      })
      .catch(() => setRecentPrints([]))
      .finally(() => { if (!controller.signal.aborted) setPrintLoading(false); });

    return () => controller.abort();
  }, [selectedStudent, refreshKey]);

  const orderedSubjects = useMemo(() => buildOrderedSubjects(progress?.subjects || []), [progress?.subjects]);
  const recentFeedback = useMemo(() => buildRecentFeedback(progress || null), [progress]);
  const suggestedNext = useMemo(() => buildSuggestedNext(progress || null), [progress]);

  const refreshProgress = () => { if (!selectedStudent || loading) return; setRefreshKey((current) => current + 1); };
  const toggleProgram = (programId: string) => setOpenPrograms((current) => ({ ...current, [programId]: !current[programId] }));

  return (
    <div>
      <Header />
      <main className="container">
        <div className="card progress-shell">
          <div className="progress-hero">
            <div>
              <h2 className="section-title">Student Profile & Progress</h2>
              <p className="text-muted progress-lead">Search for a student to see profile details, progress, recent prints, and the suggested next lesson.</p>
            </div>
            <div className="progress-actions">
              <button type="button" className="btn" onClick={refreshProgress} disabled={!selectedStudent || loading}>{loading && selectedStudent ? 'Refreshing…' : 'Refresh progress'}</button>
              {lastRefreshedAt && <span className="text-muted text-sm">Last refreshed {lastRefreshedAt}</span>}
            </div>
          </div>

          <div className="progress-picker mt-4">
            <label className="label">Student</label>
            <StudentPicker
              value={student}
              onChange={(value) => { setStudent(value); if (selectedStudent && value !== selectedStudent.name) setSelectedStudent(null); }}
              onStudentPick={setSelectedStudent}
              required
            />
          </div>

          {selectedStudent && (
            <div className="student-profile-grid mt-4">
              <section className="card">
                <h3 className="section-title" style={{fontSize:'1.2rem'}}>Student profile</h3>
                <div><strong>{selectedStudent.name}</strong></div>
                <div className="text-sm text-muted">Year: {selectedStudent.year || '—'}</div>
                <div className="text-sm text-muted">Parent: {selectedStudent.parentName || '—'}</div>
                <div className="text-sm text-muted">Email: {selectedStudent.email || '—'}</div>
                {progress && <div className="text-sm text-muted mt-2">{progress.totalPrograms} topic{progress.totalPrograms === 1 ? '' : 's'} · {progress.totalEvents} logged item{progress.totalEvents === 1 ? '' : 's'}</div>}
              </section>

              <section className="card">
                <h3 className="section-title" style={{fontSize:'1.2rem'}}>Suggested next lesson</h3>
                <div>{suggestedNext}</div>
                <div className="text-sm text-muted mt-2">Based on the student’s latest logged progress.</div>
              </section>

              <section className="card">
                <h3 className="section-title" style={{fontSize:'1.2rem'}}>Recent feedback</h3>
                {recentFeedback.length ? recentFeedback.map((e) => (
                  <div key={e.id} className="profile-list-row">
                    <strong>{e.label}</strong>
                    <div className="text-sm text-muted">{e.subject} • {e.programTitle} • {e.topic}</div>
                    <div className="text-sm text-muted">{e.tutorName || '—'} · {formatEventDate(e.timestampLabel || e.timestampIso)}</div>
                  </div>
                )) : <div className="text-sm text-muted">No recent feedback loaded.</div>}
              </section>

              <section className="card">
                <h3 className="section-title" style={{fontSize:'1.2rem'}}>Recent prints</h3>
                {printLoading ? <div className="text-sm text-muted">Loading prints…</div> : recentPrints.length ? recentPrints.map((p, idx) => (
                  <div key={`${p.timestamp}-${idx}`} className="profile-list-row">
                    <strong>{[p.year, p.subject, p.topic].filter(Boolean).join(' • ') || p.folder || 'Print'}</strong>
                    <div className="text-sm text-muted">{p.names?.slice(0,3).join(', ') || 'Printed file(s)'}</div>
                    <div className="text-sm text-muted">{p.tutor || '—'} · {formatAdminDate(p.ms || p.timestamp)}</div>
                  </div>
                )) : <div className="text-sm text-muted">No recent prints loaded.</div>}
              </section>
            </div>
          )}

          {loading && <div className="progress-empty mt-6"><div className="progress-loading-dot" aria-hidden="true" /><span>Loading progress…</span></div>}
          {!loading && error && <div className="progress-error mt-6">{error}</div>}
          {!loading && !error && !selectedStudent && <div className="progress-empty mt-6">Choose a student to load their profile and progress.</div>}

          {!loading && !error && selectedStudent && progress && (
            <div className="progress-sections mt-6">
              {orderedSubjects.map((subject) => (
                <section key={subject.key} className="progress-subject-block">
                  <div className="progress-subject-header">
                    <h3>{subject.label}</h3>
                    <span className="text-muted text-sm">{subject.programs.length} topic{subject.programs.length === 1 ? '' : 's'}</span>
                  </div>
                  {subject.programs.length === 0 ? <div className="progress-empty-card">No {subject.label} progress has been logged for this student yet.</div> : (
                    <div className="progress-program-list">
                      {subject.programs.map((program) => {
                        const isOpen = !!openPrograms[program.id];
                        return (
                          <article key={program.id} className="progress-program-card">
                            <button type="button" className="progress-program-summary" onClick={() => toggleProgram(program.id)} aria-expanded={isOpen}>
                              <div className="progress-program-main">
                                <div className="progress-program-title-row"><span className="progress-program-title">{program.title}</span><span className="progress-year-chip">{program.year}</span></div>
                              </div>
                              <div className="progress-program-summary-right"><span className={`progress-status-badge status-${program.status}`}>{formatStatus(program.status)}</span><span className={`progress-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">▾</span></div>
                            </button>
                            {isOpen && (
                              <div className="progress-program-body">
                                <div className="progress-events-header"><span>Progress history</span><span className="text-muted text-sm">Ordered by lesson, with assessment at the end.</span></div>
                                <div className="progress-events-list">
                                  {program.events.map((event) => (
                                    <div key={event.id} className="progress-event-row">
                                      <div className="progress-event-left">
                                        <div className="progress-event-label-row"><span className={`progress-event-kind ${event.kind === 'assessment' ? 'assessment' : 'lesson'}`}>{event.label}</span><span className="progress-event-topic">{event.topic}</span></div>
                                        <div className="progress-event-meta"><span>Tutor: {event.tutorName || '—'}</span></div>
                                      </div>
                                      <div className="progress-event-date">{formatEventDate(event.timestampLabel || event.timestampIso)}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
