import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '../components/Header';

type Campus = { id:string; name:string; tutors?:string[] };
type TutorOption = { campusKey:string; campusName:string; tutorName:string; role?:string };

function getFallbackCampuses(): Campus[] {
  const raw = process.env.NEXT_PUBLIC_CAMPUSES_JSON || '[]';
  const parse = (value: string): any => {
    try { return JSON.parse(value); } catch { return null; }
  };
  let parsed = parse(raw);
  if (typeof parsed === 'string') parsed = parse(parsed);
  if (!parsed) parsed = parse(raw.replace(/\\"/g, '"'));
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
  return rows.map((c: any) => ({
    id: String(c.id || c.campusKey || '').trim().toLowerCase(),
    name: String(c.name || c.campusName || c.id || c.campusKey || '').trim(),
    tutors: Array.isArray(c.tutors) ? c.tutors : [],
  })).filter((c: Campus) => c.id && c.name);
}

export default function LoginPage() {
  const router = useRouter();
  const fallbackCampuses = useMemo(() => getFallbackCampuses(), []);
  const [campuses, setCampuses] = useState<Campus[]>(fallbackCampuses.length ? fallbackCampuses : [{ id:'parramatta', name:'Parramatta', tutors: [] }]);
  const [tutorOptions, setTutorOptions] = useState<TutorOption[]>([]);
  const [tutorLoadError, setTutorLoadError] = useState('');
  const [tutorDebug, setTutorDebug] = useState<any>(null);
  const [campusId, setCampusId] = useState((fallbackCampuses[0]?.id || 'parramatta').toLowerCase());
  const [tutor, setTutor] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingTutors, setLoadingTutors] = useState(false);
  const [error, setError] = useState<string|undefined>();

  // Only ever redirect to a same-origin path. A crafted link like
  // /login?next=https://evil.example could otherwise bounce a freshly
  // logged-in tutor to an attacker's page.
  const rawNext = typeof router.query.next === 'string' ? router.query.next : '';
  const nextPath =
    rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('\\') && !rawNext.includes('://')
      ? rawNext
      : '/feedback';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTutors(true);
      setTutorLoadError('');
      setTutorDebug(null);
      try {
        const res = await fetch('/api/tutors', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not load tutor list');
        if (cancelled) return;
        setTutorDebug(json?.debug || null);
        if (json?.warning) setTutorLoadError(String(json.warning));
        const apiCampuses = Array.isArray(json.campuses) ? json.campuses : [];
        const apiTutors = Array.isArray(json.tutors) ? json.tutors : [];
        if (apiCampuses.length) {
          setCampuses(apiCampuses.map((c:any) => ({ id: String(c.id || c.campusKey || '').toLowerCase(), name: String(c.name || c.campusName || c.id || '') })));
          setCampusId((apiCampuses[0].id || apiCampuses[0].campusKey || 'parramatta').toLowerCase());
        }
        setTutorOptions(apiTutors.map((t:any) => ({
          campusKey: String(t.campusKey || '').toLowerCase(),
          campusName: String(t.campusName || ''),
          tutorName: String(t.tutorName || ''),
          role: String(t.role || 'tutor'),
        })).filter((t:TutorOption) => t.tutorName));
      } catch (e:any) {
        if (cancelled) return;
        setTutorLoadError(e?.message || 'Could not load tutor list');
        setTutorDebug(null);
        // Fallback to old env var tutor list if API is unavailable.
        const legacyTutors: TutorOption[] = [];
        for (const c of fallbackCampuses) {
          for (const t of (c.tutors || [])) {
            legacyTutors.push({ campusKey: String(c.id || '').toLowerCase(), campusName: c.name, tutorName: t, role: 'tutor' });
          }
        }
        setTutorOptions(legacyTutors);
      } finally {
        if (!cancelled) setLoadingTutors(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fallbackCampuses]);

  const currentTutors = useMemo(
    () => tutorOptions.filter(t => !campusId || t.campusKey === campusId).map(t => t.tutorName).slice().sort(),
    [campusId, tutorOptions]
  );

  useEffect(() => {
    if (tutor && currentTutors.length && !currentTutors.includes(tutor)) setTutor('');
  }, [campusId, currentTutors, tutor]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try {
      const pickedTutor = tutor.trim();
      if (!pickedTutor) throw new Error('Pick your tutor name before signing in.');
      const res = await fetch('/api/login', {
        method:'POST',
        headers: {'Content-Type':'application/json'},
        credentials: 'include',
        body: JSON.stringify({ campus: campusId, tutor: pickedTutor, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'Login failed');
      try {
        const finalTutor = data?.tutor || pickedTutor;
        const shortTutor = finalTutor.split(/\s+/).filter(Boolean)[0] || finalTutor;
        localStorage.setItem('st_tutor', shortTutor);
        localStorage.setItem('st_tutor_full', finalTutor);
        localStorage.setItem('st_campus', campuses.find(c => c.id === campusId)?.name || campusId);
        localStorage.setItem('st_is_admin', String(data?.role || '').toLowerCase() === 'admin' ? '1' : '0');
      } catch {}
      window.location.assign(nextPath);
    } catch (e:any) {
      setError(e?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-login">
      <Header />
      <main className="container page-login-main" style={{maxWidth:'860px'}}>
        <div className="card login-card">
          <h1 className="section-title" style={{marginBottom:'.5rem'}}>Success Tutoring</h1>
          <p className="text-muted" style={{marginBottom:'1.5rem', fontSize:'1.1rem'}}>Sign in to continue</p>

          <form onSubmit={submit} className="grid grid-col" autoComplete="off">
            <div>
              <label className="label">Campus</label>
              <select className="input" value={campusId} onChange={e=>setCampusId(e.target.value)}>
                {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                {!campuses.length && <option value="parramatta">Parramatta</option>}
              </select>
            </div>

            <div>
              <label className="label">Tutor</label>
              <div className="tutor-picker">
                <input
                  list="tutors"
                  className="input tutor-input"
                  value={tutor}
                  onChange={e=>setTutor(e.target.value)}
                  placeholder={loadingTutors ? 'Loading tutors…' : 'Type or pick your name'}
                  autoComplete="off"
                  disabled={loadingTutors && !currentTutors.length}
                />
                <select className="input tutor-select" value={tutor} onChange={e=>setTutor(e.target.value)} disabled={loadingTutors && !currentTutors.length}>
                  <option value="">{loadingTutors ? 'Loading tutors…' : 'Select tutor…'}</option>
                  {currentTutors.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <datalist id="tutors">
                  {currentTutors.map(t => <option key={t} value={t}>{t}</option>)}
                </datalist>
              </div>
              {tutorLoadError && <div className="text-sm mt-2" style={{color:'#fca5a5'}}>Tutor config issue: {tutorLoadError}</div>}
              {!loadingTutors && !currentTutors.length && <div className="text-sm" style={{color:'#fca5a5', marginTop:'.5rem'}}>No active tutors found for this campus. Check that the Tutor Config sheet has an active row where campusKey is <b>{campusId}</b>.</div>}
              {tutorDebug && !currentTutors.length && (
                <div className="text-sm text-muted mt-2" style={{lineHeight:1.5}}>
                  <div>Loaded source: <b>{tutorDebug.source || 'unknown'}</b> · Sheet: <b>{tutorDebug.sheetName || 'unknown'}</b></div>
                  <div>Total tutors loaded: <b>{tutorDebug.totalTutors ?? 0}</b> · Active tutors: <b>{tutorDebug.activeTutors ?? 0}</b></div>
                  {Array.isArray(tutorDebug.activeCampusKeys) && tutorDebug.activeCampusKeys.length > 0 && <div>Active campus keys found: <b>{tutorDebug.activeCampusKeys.join(', ')}</b></div>}
                  {Array.isArray(tutorDebug.campusKeys) && tutorDebug.campusKeys.length > 0 && !tutorDebug.activeCampusKeys?.length && <div>Campus keys found: <b>{tutorDebug.campusKeys.join(', ')}</b></div>}
                </div>
              )}
            </div>

            <div>
              <label className="label">Password</label>
              <div className="flex gap-2">
                <input type={showPwd?'text':'password'} className="input" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter site password" />
                <button type="button" className="btn" onClick={()=>setShowPwd(v=>!v)}>{showPwd?'Hide':'Show'}</button>
              </div>
            </div>

            {error && <div className="mt-2" style={{color:'#fca5a5'}}>{error}</div>}

            <div className="mt-4">
              <button type="submit" className="btn-primary w-full" disabled={busy || loadingTutors}>{busy?'Signing in…':'Sign in'}</button>
            </div>

            <p className="text-sm text-muted" style={{marginTop:'.75rem'}}>You’ll be redirected to <b>{nextPath}</b> after login.</p>
          </form>
        </div>
      </main>
    </div>
  );
}
