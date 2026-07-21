import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../components/Header';
import StudentPicker, { type StudentPickerValue } from '../components/StudentPicker';
import StickyBar from '../components/StickyBar';
import RecentStudents from '../components/RecentStudents';
import { applyTokens, defaultClosing, PronounSet } from '../lib/tokens';
import { rememberRecentStudent, type RecentStudent } from '../lib/recentStudents';

type Curriculum = {
  Year?: string;
  Subject?: string;
  Strand?: string;
  Lesson?: string;
  Topic?: string;
  Template1?: string;
  Template2?: string;
  Template3?: string;
};

type LastFeedback = {
  key: string;
  at: number;
  parentName: string;
};

export default function FeedbackPage() {
  const campusName = process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring';
  const campusKey = (() => {
    try {
      const parsed = JSON.parse(process.env.NEXT_PUBLIC_CAMPUSES_JSON || '[]');
      const campuses = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return String(campuses[0]?.id || campuses[0]?.campusKey || 'parramatta').trim().toLowerCase();
    } catch {
      return 'parramatta';
    }
  })();

  // Curriculum vs Custom feedback
  const [mode, setMode] = useState<'curriculum' | 'custom'>('curriculum');
  const isCustom = mode === 'custom';

  const [student, setStudent] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<StudentPickerValue | null>(null);
  const [recentRefreshKey, setRecentRefreshKey] = useState(0);
  const [parentName, setParentName] = useState('');
  const [pronouns, setPronouns] = useState<PronounSet>('');
  const [year, setYear] = useState('');
  const [subject, setSubject] = useState('');
  const [strand, setStrand] = useState('');
  const [lesson, setLesson] = useState('');
  const [topic, setTopic] = useState('');
  const [rows, setRows] = useState<Curriculum[]>([]);
  const [template, setTemplate] = useState('');
  const [custom, setCustom] = useState('');
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState<number | null>(null);
  const [hasEditedCustom, setHasEditedCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tutorName, setTutorName] = useState('');
  const [lastFeedback, setLastFeedback] = useState<LastFeedback | null>(null);
  const [isSending, setIsSending] = useState(false);

  const [hasPendingSend, setHasPendingSend] = useState(false);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const pendingTimeoutRef = useRef<number | null>(null);
  const pendingIntervalRef = useRef<number | null>(null);
  const pendingPayloadRef = useRef<any | null>(null);

  useEffect(() => {
    try {
      setTutorName(localStorage.getItem('st_tutor') || '');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/curriculum', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not load curriculum');
        const raw = json.rows || [];
        const normalised: Curriculum[] = (raw || [])
          .map((r: any) => ({
            Year: r.Year ?? r.year ?? '',
            Subject: r.Subject ?? r.subject ?? '',
            Strand: r.Strand ?? r.strand ?? '',
            Lesson: r.Lesson ?? r.lesson ?? '',
            Topic: r.Topic ?? r.topic ?? '',
            Template1: r.Template1 ?? r.template1 ?? '',
            Template2: r.Template2 ?? r.template2 ?? '',
            Template3: r.Template3 ?? r.template3 ?? '',
          }))
          .filter((r) => r.Year && r.Subject && r.Strand && r.Lesson);
        setRows(normalised);
      } catch (e: any) {
        console.error('Failed to load curriculum', e);
        setError('Failed to load curriculum – please try Refresh.');
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (pendingTimeoutRef.current) window.clearTimeout(pendingTimeoutRef.current);
      if (pendingIntervalRef.current) window.clearInterval(pendingIntervalRef.current);
    };
  }, []);

  const groups = useMemo(() => {
    return rows.filter((r) => r.Year && r.Subject && r.Strand && r.Lesson);
  }, [rows]);

  const years = useMemo(
    () => Array.from(new Set(groups.map((r) => r.Year!))),
    [groups],
  );
  const subjects = useMemo(
    () => Array.from(new Set(groups.filter((r) => r.Year === year).map((r) => r.Subject!))),
    [groups, year],
  );
  const strands = useMemo(
    () =>
      Array.from(
        new Set(
          groups
            .filter((r) => r.Year === year && r.Subject === subject)
            .map((r) => r.Strand!),
        ),
      ),
    [groups, year, subject],
  );
  const lessons = useMemo(
    () =>
      Array.from(
        new Set(
          groups
            .filter((r) => r.Year === year && r.Subject === subject && r.Strand === strand)
            .map((r) => r.Lesson!),
        ),
      ),
    [groups, year, subject, strand],
  );

  const currentRow = useMemo(
    () =>
      groups.find(
        (r) =>
          r.Year === year &&
          r.Subject === subject &&
          r.Strand === strand &&
          r.Lesson === lesson,
      ) || null,
    [groups, year, subject, strand, lesson],
  );

  useEffect(() => {
    // In curriculum mode, the topic + default template are driven by the curriculum row.
    // In custom mode, the user can type their own Topic and message.
    // Depends on the whole row (not just the Topic string): two lessons can share
    // a Topic, and previously switching between them kept the old lesson's
    // hand-typed message. Any lesson change must reset the draft.
    if (isCustom) return;
    setTopic(currentRow?.Topic || '');
    setTemplate('');
    setCustom('');
    setHasEditedCustom(false);
  }, [currentRow, isCustom]);

  const firstName = useMemo(
    () => (student ? student.split(' ')[0] : ''),
    [student],
  );

  const tokens = useMemo(
    () => ({
      name: firstName || student || 'your child',
      topic: topic || currentRow?.Topic || '',
      subject: subject || '',
      pronouns,
      parent: parentName || 'Parent',
    }),
    [firstName, student, topic, currentRow?.Topic, subject, pronouns, parentName],
  );

  const subjectLine = useMemo(() => {
    if (!student) return '';

    const lessonLabel = lesson ? `Lesson ${lesson}` : '';

    if (isCustom) {
      const mid = [subject || 'Custom Feedback', topic, lessonLabel].filter(Boolean).join(' • ');
      return `${firstName || student} – ${mid}`;
    }

    if (!subject || !strand || !lesson) return '';
    // Include the strand/program code next to the lesson number, e.g. "BOL Lesson 3",
    // so parents/admins can see both the workbook code and the specific lesson.
    const strandLesson = [strand, lessonLabel].filter(Boolean).join(' ');
    const topicBit = topic && topic !== strand ? topic : '';
    const mid = [subject, strandLesson, topicBit].filter(Boolean).join(' • ');
    return `${firstName || student} – ${mid}`;
  }, [student, firstName, subject, strand, lesson, topic, isCustom]);

  const body = useMemo(() => {
    const raw = (custom || template || '').trim();
    if (!raw) return '';
    const main = applyTokens(raw, tokens);
    const greeting = parentName
      ? `Hi ${parentName},`
      : 'Hi Parent,';

    const extraLines: string[] = [];
    if (year) extraLines.push(`Year focus: ${year}`);
    if (tutorName) extraLines.push(`Tutor: ${tutorName}`);
    const extraBlock = extraLines.length ? `\n\n${extraLines.join('\n')}` : '';

    return `${greeting}\n\n${main}${extraBlock}\n\n${defaultClosing(campusName)}`;
  }, [custom, template, tokens, campusName, parentName, year, tutorName]);

  const canSend = !!student && !!body && !!subjectLine;

  function handleUseTemplate(index: number, text: string) {
    setTemplate(text || '');
    setHasEditedCustom(false);
    setSelectedTemplateIndex(index);
    // custom text will be populated via body/tokens when rendered
    setCustom(applyTokens(text || '', tokens));
  }

  
  // Keep the draft message in sync when the tutor changes student / pronouns / topic,
  // as long as they haven't manually edited the message.
  useEffect(() => {
    if (isCustom) return;
    if (selectedTemplateIndex === null) return;
    if (hasEditedCustom) return;

    const src =
      selectedTemplateIndex === 0 ? currentRow?.Template1 :
      selectedTemplateIndex === 1 ? currentRow?.Template2 :
      selectedTemplateIndex === 2 ? currentRow?.Template3 :
      '';

    const text = (src || template || '').trim();
    if (!text) return;

    setCustom(applyTokens(text, tokens));
  }, [isCustom, selectedTemplateIndex, hasEditedCustom, currentRow, template, tokens]);
function handleCustomChange(v: string) {
    setCustom(v);
    setHasEditedCustom(true);
    setSelectedTemplateIndex(null);
  }

  function clearAll() {
    setMode('curriculum');
    setStudent('');
    setSelectedStudent(null);
    setParentName('');
    setPronouns('');
    setYear('');
    setSubject('');
    setStrand('');
    setLesson('');
    setTopic('');
    setTemplate('');
    setCustom('');
    setSelectedTemplateIndex(null);
    setHasEditedCustom(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // NOTE: we deliberately do NOT cancel any pending send.
  }

  function setFeedbackMode(next: 'curriculum' | 'custom') {
    setMode(next);
    // Keep the chosen student, but reset the form fields so the UI is predictable.
    setYear('');
    setSubject('');
    setStrand('');
    setLesson('');
    setTopic('');
    setTemplate('');
    setCustom('');
    setHasEditedCustom(false);
    setSelectedTemplateIndex(null);
  }


  function applyRecentStudent(s: RecentStudent) {
    setStudent(s.name);
    setSelectedStudent({
      id: s.id,
      firstName: s.firstName || s.name.split(/\s+/)[0] || s.name,
      lastName: s.lastName || '',
      name: s.name,
      email: s.email || '',
      parentName: s.parentName || '',
      year: s.year || '',
      gender: s.gender || '',
      pronouns: s.pronouns || '',
    });
    setParentName(s.parentName || '');
    const raw = `${s.pronouns || ''} ${s.gender || ''}`.toLowerCase();
    if (raw.includes('she') || raw.includes('female')) setPronouns('she/her');
    else if (raw.includes('he') || raw.includes('male')) setPronouns('he/him');
    else if (raw.includes('they')) setPronouns('they/them');
    else setPronouns('');
  }

  async function findDuplicateFeedback(payload: any) {
    try {
      const res = await fetch('/api/check-duplicate-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: payload.meta?.studentName || payload.toName,
          parentEmail: payload.meta?.parentEmail || '',
          year: payload.meta?.year || '',
          subject: payload.meta?.subject || '',
          strand: payload.meta?.strand || '',
          lesson: payload.meta?.lessonNumber || payload.meta?.lesson || '',
          topic: payload.meta?.topic || '',
        }),
      });
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json?.duplicates) ? json.duplicates : [];
    } catch {
      return [];
    }
  }

  function makeFeedbackKey(): string {
    return [student, subject, strand, lesson, topic].join('|');
  }

  async function actuallySendFromPending() {
    if (!pendingPayloadRef.current) return;

    const payload = pendingPayloadRef.current;
    pendingPayloadRef.current = null;
    if (pendingTimeoutRef.current) window.clearTimeout(pendingTimeoutRef.current);
    if (pendingIntervalRef.current) window.clearInterval(pendingIntervalRef.current);
    pendingTimeoutRef.current = null;
    pendingIntervalRef.current = null;
    setHasPendingSend(false);
    setPendingSeconds(0);

    setIsSending(true);
    try {
      const res = await fetch('/api/send-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        alert(j?.error || 'Failed to send feedback.');
      } else {
        const key = makeFeedbackKey();
        setLastFeedback({
          key,
          at: Date.now(),
          parentName: payload.meta?.parentName || parentName || 'Parent',
        });
      }
    } catch (e: any) {
      alert(e?.message || 'Failed to send feedback.');
    } finally {
      setIsSending(false);
    }
  }

  async function scheduleSend() {
    if (!canSend || isSending || hasPendingSend) return;

    const key = makeFeedbackKey();
    const now = Date.now();
    if (lastFeedback && lastFeedback.key === key && now - lastFeedback.at < 5 * 60 * 1000) {
      const again = window.confirm(
        `You recently sent feedback for this student and lesson. Send again anyway?`,
      );
      if (!again) return;
    }

    const feedbackType = isCustom
      ? 'custom'
      : (String(lesson).toLowerCase() === 'assessment' || String(topic).toLowerCase() === 'assessment')
        ? 'assessment'
        : 'curriculum_lesson';
    const lessonNumber = feedbackType === 'assessment' ? '' : lesson;
    const programLabel = strand || subject || topic || 'Custom Feedback';
    const programKey = [subject, programLabel, year]
      .filter(Boolean)
      .join('_')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const payload = {
      toName: student,
      subject: subjectLine,
      text: body,
      meta: {
        campusKey,
        campusName,
        tutorName,
        studentId: selectedStudent?.id || '',
        studentName: selectedStudent?.name || student,
        studentFirstName: selectedStudent?.firstName || firstName || student,
        studentLastName: selectedStudent?.lastName || '',
        studentYear: selectedStudent?.year || '',
        parentName: selectedStudent?.parentName || parentName || 'Parent',
        parentEmail: selectedStudent?.email || '',
        mode: isCustom ? 'custom' : 'curriculum',
        feedbackType,
        programKey,
        programLabel,
        templateIndex: selectedTemplateIndex === null ? '' : String(selectedTemplateIndex + 1),
        lessonNumber,
        assessmentName: feedbackType === 'assessment' ? (topic || lesson || 'Assessment') : '',
        completionStatus: feedbackType === 'assessment' ? 'completed' : 'in_progress',
        sourceForm: 'feedback',
        year,
        subject,
        strand,
        lesson,
        topic,
        subjectLine,
      },
    };

    const duplicates = await findDuplicateFeedback(payload);
    if (duplicates.length) {
      const first = duplicates[0];
      const when = first.timestamp || 'recently';
      const by = first.tutorName || 'another tutor';
      const lessonLabel = [year, subject, strand || topic, lesson ? `Lesson ${lesson}` : '']
        .filter(Boolean)
        .join(' • ');
      const ok = window.confirm(
        `Possible duplicate feedback found.\n\n${student} already had feedback for ${lessonLabel} sent ${when} by ${by}.\n\nSend again anyway?`
      );
      if (!ok) return;
    }

    pendingPayloadRef.current = payload;
    setHasPendingSend(true);
    setPendingSeconds(5);

    if (pendingTimeoutRef.current) window.clearTimeout(pendingTimeoutRef.current);
    if (pendingIntervalRef.current) window.clearInterval(pendingIntervalRef.current);

    pendingTimeoutRef.current = window.setTimeout(() => {
      actuallySendFromPending();
    }, 5000) as unknown as number;

    pendingIntervalRef.current = window.setInterval(() => {
      setPendingSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000) as unknown as number;
  }

  function undoPending() {
    if (pendingTimeoutRef.current) window.clearTimeout(pendingTimeoutRef.current);
    if (pendingIntervalRef.current) window.clearInterval(pendingIntervalRef.current);
    pendingTimeoutRef.current = null;
    pendingIntervalRef.current = null;
    pendingPayloadRef.current = null;
    setHasPendingSend(false);
    setPendingSeconds(0);
  }

  const sendLabel = isSending ? 'Sending…' : 'Send to Parent';

  return (
    <div>
      <Header />
      <main className="container">
        <div className="card">
          <h2 className="section-title">Parent Feedback</h2>
          <p className="text-muted">
            Pick a student and lesson, choose a template, then customise the message if needed.
          </p>

          <div className="segmented mt-4">
            <button
              type="button"
              className={`seg-btn ${!isCustom ? 'active' : ''}`}
              onClick={() => setFeedbackMode('curriculum')}
            >
              Curriculum feedback
            </button>
            <button
              type="button"
              className={`seg-btn ${isCustom ? 'active' : ''}`}
              onClick={() => setFeedbackMode('custom')}
            >
              Custom feedback
            </button>
          </div>

          {isCustom && (
            <div className="text-sm text-muted mt-2">
              Custom mode: type any subject/topic you need (Selective, OC, NAPLAN, etc.) and write the message
              below.
            </div>
          )}

          <div className="mt-4">
            <label className="label">Student</label>
            <StudentPicker
              value={student}
              onChange={(v) => {
                setStudent(v);
                if (selectedStudent && v !== selectedStudent.name) {
                  setSelectedStudent(null);
                  setParentName('');
                }
              }}
              onPronouns={setPronouns}
              onParentName={setParentName}
              onStudentPick={(s) => {
                setSelectedStudent(s);
                setParentName(s?.parentName || '');
                if (s) {
                  rememberRecentStudent(s);
                  setRecentRefreshKey(k => k + 1);
                }
              }}
              required
            />
            <RecentStudents refreshKey={recentRefreshKey} onSelect={applyRecentStudent} />
          </div>

          {!isCustom && (
            <div className="grid grid-2 grid-col mt-4">
            <div>
              <label className="label">Year</label>
              <select
                className="input"
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setSubject('');
                  setStrand('');
                  setLesson('');
                }}
              >
                <option value="">Select year…</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Subject</label>
              <select
                className="input"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  setStrand('');
                  setLesson('');
                }}
              >
                <option value="">Select subject…</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            </div>
          )}

          {!isCustom && (
            <div className="grid grid-2 grid-col mt-3">
            <div>
              <label className="label">Strand</label>
              <select
                className="input"
                value={strand}
                onChange={(e) => {
                  setStrand(e.target.value);
                  setLesson('');
                }}
              >
                <option value="">Select strand…</option>
                {strands.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Lesson</label>
              <select
                className="input"
                value={lesson}
                onChange={(e) => setLesson(e.target.value)}
              >
                <option value="">Select lesson…</option>
                {lessons.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            </div>
          )}

          {isCustom && (
            <div className="grid grid-2 grid-col mt-4">
              <div>
                <label className="label">Year (optional)</label>
                <input
                  className="input"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g. Year 6"
                />
              </div>
              <div>
                <label className="label">Subject / Program (optional)</label>
                <input
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Naplan, Selective, OC"
                />
              </div>
              <div>
                <label className="label">Lesson / Session (optional)</label>
                <input
                  className="input"
                  value={lesson}
                  onChange={(e) => setLesson(e.target.value)}
                  placeholder="e.g. 5"
                />
              </div>
              <div>
                <label className="label">Strand / Area (optional)</label>
                <input
                  className="input"
                  value={strand}
                  onChange={(e) => setStrand(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
          )}

          <div className="mt-3">
            <label className="label">Topic</label>
            <input
              className="input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic"
            />
          </div>

          {!isCustom && currentRow && (
            <section className="mt-4">
              <h3 className="text-sm text-muted mb-2">Templates</h3>
              <div className="grid grid-3 grid-col">
                {[currentRow.Template1, currentRow.Template2, currentRow.Template3]
                  .map((text, originalIndex) => ({ text, originalIndex }))
                  .filter((item) => Boolean(item.text))
                  .map(({ text: t, originalIndex }) => {
                    const isSelected = selectedTemplateIndex === originalIndex;
                    return (
                    <div
                      key={originalIndex}
                      className={`card p-3 template-card ${isSelected ? 'selected-template' : ''}`}
                    >
                      <div className="template-card-head">
                        <div className="text-sm text-muted">Option {originalIndex + 1}</div>
                        {isSelected && <span className="template-selected-badge">Selected</span>}
                      </div>
                      <p className="text-sm" style={{ whiteSpace: 'pre-line' }}>
                        {applyTokens(t || '', tokens)}
                      </p>
                      <button
                        type="button"
                        className={`btn mt-3 w-full template-use-btn ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleUseTemplate(originalIndex, t || '')}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? 'Using this template' : 'Use this'}
                      </button>
                    </div>
                    );
                  })}
                {!currentRow.Template1 &&
                  !currentRow.Template2 &&
                  !currentRow.Template3 && (
                    <div className="text-sm text-muted">
                      No templates for this lesson – type a custom message below.
                    </div>
                  )}
              </div>
            </section>
          )}

          <section className="mt-4">
            <label className="label">Custom message</label>
            <textarea
              className="input"
              value={custom}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder={
                isCustom
                  ? 'Write a custom message…'
                  : 'Start typing or pick a template above…'
              }
            />
            <p className="text-sm text-muted mt-2">
              Tokens like {'{name}'}, {'{topic}'}, {'{they}'}, {'{their}'} will be filled in automatically.
            </p>
          </section>

          <section className="mt-4">
            <h3 className="text-sm text-muted mb-1">Preview</h3>
            <div className="card p-3" style={{ whiteSpace: 'pre-line', fontSize: '.9rem' }}>
              <div className="text-sm text-muted mb-2">Subject</div>
              <div className="mb-3">{subjectLine || '(subject will appear here)'}</div>
              <div className="text-sm text-muted mb-2">Email</div>
              <div>{body || '(message will appear here)'}</div>
              {lastFeedback && (
                <div className="text-sm text-muted mt-3">
                  Last sent to {lastFeedback.parentName} at{' '}
                  {new Date(lastFeedback.at).toLocaleTimeString()}
                </div>
              )}
            </div>
          </section>

          {error && (
            <div className="mt-3 text-sm" style={{ color: '#fca5a5' }}>
              {error}
            </div>
          )}
        </div>
      </main>

      {hasPendingSend && (
        <div className="undo-banner">
          <span>
            Message scheduled – sending in {pendingSeconds || 1}s
          </span>
          <button type="button" className="btn" onClick={undoPending}>
            Undo
          </button>
        </div>
      )}

      <StickyBar>
        <button
          className="btn-primary flex-1"
          type="button"
          disabled={!canSend || isSending || hasPendingSend}
          onClick={scheduleSend}
        >
          {sendLabel}
        </button>
        <button
          className="btn flex-1"
          type="button"
          onClick={clearAll}
        >
          Clear
        </button>
        <button
          className="btn flex-1"
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          Return to top
        </button>
      </StickyBar>

      <footer className="container footer mt-8" style={{ textAlign: 'center' }}>
        © {campusName} · Made By Kevin John Abu
      </footer>
    </div>
  );
}
