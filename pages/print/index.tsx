import { useEffect, useMemo, useRef, useState } from 'react';
import Header from '../../components/Header';
import StudentPicker from '../../components/StudentPicker';
import RecentStudents from '../../components/RecentStudents';
import StudentPrintHistory from '../../components/StudentPrintHistory';
import { usePrintActivity } from '../../components/PrintActivityProvider';
import type { PrintItem } from '../../lib/printActivity';
import useAuthGuard from '../../hooks/useAuthGuard';
import type { PronounSet } from '../../lib/tokens';
import { rememberRecentStudent, type RecentStudent } from '../../lib/recentStudents';
import type { PrintColorMode, PrintSettings } from '../../lib/printSettings';
import {
  DEFAULT_PRINT_SETTINGS,
  buildPrintColorPayload,
  compactPrintSettingsSummary,
  cupsPrintColorMode,
  mergePrintSettings,
  printModeLabel,
  resolvePrintMode,
  resolvePrintRuleKey,
  normalizePrintFolderSegments,
} from '../../lib/printSettings';
import {
  CatalogItem,
  buildCatalogTree,
  getNode,
  isStandardYearLabel,
  listChildNames,
  sortFilesForDisplay,
  TreeNode,
} from '../../lib/catalog';

function getTutorName() {
  try {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('st_tutor') || '';
  } catch {
    return '';
  }
}

function materialPath(file: any) {
  return String(file?.path || file?.material_path || file?.file_path || '').trim();
}

export default function PrintPage() {
  useAuthGuard();

  const [status, setStatus] = useState('Checking…');
  const [printerName, setPrinterName] = useState('');
  const [qty, setQty] = useState(1);
  const [student, setStudent] = useState('');
  const [studentId, setStudentId] = useState('');
  const { enqueue, hasActive } = usePrintActivity();
  const [recentRefreshKey, setRecentRefreshKey] = useState(0);
  // Print flow doesn't currently use pronouns, but StudentPicker can emit them.
  // Keep the setter for future logging/metadata without introducing unused locals.
  const [, setPronouns] = useState<PronounSet>('');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [msg, setMsg] = useState('');
  const [printSettings, setPrintSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [stampEnabled, setStampEnabled] = useState(true);
  const [stampCanToggle, setStampCanToggle] = useState(false);
  const [stampLoaded, setStampLoaded] = useState(false);
  const [stampSaving, setStampSaving] = useState(false);
  const [stampStatusMsg, setStampStatusMsg] = useState('Checking the connected Mac print service…');

  const [navPath, setNavPath] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [needStudent, setNeedStudent] = useState(false);

  const topRef = useRef<HTMLDivElement>(null);
  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth' });
  const selectionRef = useRef<HTMLDivElement>(null);
  const printingRef = useRef(false);
  const scrollSelection = () => selectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });


  function applyRecentStudent(s: RecentStudent) {
    setStudent(s.name);
    setStudentId(s.id || '');
    setMsg(`Selected ${s.name}`);
  }

  async function loadPrintSettings(): Promise<PrintSettings> {
    try {
      const res = await fetch('/api/print-settings', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'settings unavailable');
      const nextSettings = mergePrintSettings(json.settings || {});
      setPrintSettings(nextSettings);
      if (!json?.configured?.csv) setSettingsMsg('Using recommended print colour defaults.');
      else if (json?.warning) setSettingsMsg(json.warning);
      else setSettingsMsg('');
      setSettingsLoaded(true);
      return nextSettings;
    } catch {
      setPrintSettings(DEFAULT_PRINT_SETTINGS);
      setSettingsMsg('Using recommended print colour defaults.');
      setSettingsLoaded(true);
      return DEFAULT_PRINT_SETTINGS;
    }
  }

  function applyStampStatus(payload: any) {
    const hasEnabledValue = typeof payload?.pdfStampEnabled === 'boolean';
    setStampEnabled(hasEnabledValue ? payload.pdfStampEnabled : true);
    setStampCanToggle(payload?.pdfStampRuntimeConfigurable === true);
    setStampLoaded(true);

    if (payload?.pdfStampRuntimeConfigurable === true) {
      setStampStatusMsg('This choice is saved on the connected Mac print service and survives restarts. Diagnostic tests are always left unstamped.');
    } else if (hasEnabledValue) {
      setStampStatusMsg('The connected Mac print service supports student-name stamping, but it must be updated to v1.6.56 before this switch can be changed from the portal.');
    } else {
      setStampStatusMsg('Update and restart the connected Mac print service to v1.6.56 before using this switch.');
    }
  }

  async function changeStampEnabled(nextEnabled: boolean) {
    if (!stampCanToggle || stampSaving || hasActive) return;
    setStampSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/print-proxy?action=stamp-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || typeof json?.pdfStampEnabled !== 'boolean') {
        throw new Error(json?.error || 'Could not change the PDF name setting.');
      }
      applyStampStatus(json);
      setMsg(json.pdfStampEnabled
        ? 'Student names will be added to printable PDFs.'
        : 'Student-name stamping is turned off.');
    } catch (error: any) {
      setMsg(error?.message || 'Could not change the PDF name setting.');
    } finally {
      setStampSaving(false);
    }
  }

  async function refresh() {
    setMsg('');
    setSettingsLoaded(false);
    setStampLoaded(false);
    setStampStatusMsg('Checking the connected Mac print service…');
    const settingsPromise = loadPrintSettings();
    try {
      const h = await fetch('/api/print-proxy?action=health').then((r) => r.json());
      if (!h?.ok) throw new Error('Not connected');
      setPrinterName(h.printer || '');
      setStatus(`Connected · ${h.printer || 'Printer'}`);
      applyStampStatus(h);
      const c = await fetch('/api/print-proxy?action=catalog').then((r) => r.json());
      setCatalog(c?.items || []);
      await settingsPromise;
    } catch {
      setPrinterName('');
      setStatus('Not Connected');
      setCatalog([]);
      setStampCanToggle(false);
      setStampLoaded(true);
      setStampStatusMsg('Connect the Mac print service before changing this setting.');
      await settingsPromise.catch(() => DEFAULT_PRINT_SETTINGS);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const tree: TreeNode = useMemo(() => buildCatalogTree(catalog), [catalog]);
  const node = useMemo(() => getNode(tree, navPath), [tree, navPath]);
  const childNames = useMemo(() => listChildNames(node), [node]);
  const rootLabel = navPath[0] || '';
  // For standard Kindy → Year 10 content we apply the L1/R1/... ordering to *any* folder that contains files.
  const standardOrdering = isStandardYearLabel(rootLabel);

  const files = useMemo(() => sortFilesForDisplay(node.files || [], standardOrdering), [node.files, standardOrdering]);

  // Quick-jump dropdowns (one per folder level). Great for desktop printing.
  const dropdownLevels = useMemo(() => {
    const levels: { label: string; options: string[]; value: string }[] = [];

    const labelForDepth = (d: number) => {
      if (d === 0) return 'Year / Program';
      if (d === 1) return 'Subject / Folder';
      if (d === 2) return 'Strand / Folder';
      return 'Folder';
    };

    let cursor: TreeNode = tree;
    for (let depth = 0; depth < 12; depth++) {
	      const children = Array.from(cursor.children.values());
	      const opts = children.map((c) => c.name).sort((a, b) => a.localeCompare(b));
      if (!opts.length) break;
      const value = navPath[depth] || '';
      levels.push({ label: labelForDepth(depth), options: opts, value });
      if (!value) break;
	      const next = children.find((c) => c.name === value);
      if (!next) break;
      cursor = next;
    }

    return levels;
  }, [tree, navPath]);

  const setDropdownAt = (depth: number, value: string) => {
    setMsg('');
    setNavPath((prev) => {
      const next = prev.slice(0, depth);
      if (value) next[depth] = value;
      return next;
    });
    // Intentionally do NOT auto-scroll when changing dropdowns.
    // Auto-scrolling makes desktop navigation feel "jumpy" and forces
    // users to constantly move their mouse back up.
  };

  function clearAll() {
    // Clear everything the tutor may have entered/selected on the Print page
    // so they can start a new print flow without refreshing.
    setStudent('');
    setStudentId('');
    setNavPath([]);
    setQty(1);
    setMsg('');
    setNeedStudent(false);
    scrollTop();
  }

  function goBack() {
    setMsg('');
    setNavPath((p) => p.slice(0, Math.max(0, p.length - 1)));
  }

  function currentFolderMeta() {
    const root = navPath[0] || '';
    const standard = isStandardYearLabel(root);
    let year = root;
    let subject = '';
    let topic = '';
    let strand = '';
    let content = '';

    if (standard) {
      // Standard school content: Year -> Subject -> Strand -> optional extra folder/content
      subject = navPath[1] || '';
      strand = navPath[2] || '';
      topic = strand || navPath[navPath.length - 1] || '';
      content = navPath.slice(3).join(' / ');
    } else {
      // Custom programs: keep the first folder as the program/year column, then follow folder names.
      // Avoid duplicating "Term 3" as both subject and topic when path is only Program / Term.
      subject = navPath[1] || '';
      topic = navPath.length >= 3 ? (navPath[navPath.length - 1] || '') : '';
      strand = navPath.length >= 3 ? (navPath[1] || '') : '';
      content = navPath.length >= 3 ? navPath.slice(2, -1).join(' / ') : '';
    }

    return {
      year,
      subject,
      topic,
      strand,
      content,
      folder: navPath.join(' / '),
      path: navPath.slice(),
      printer: printerName || '',
      tutor: getTutorName(),
    };
  }

  function materialType(file: any) {
    return file._typeLabel || file.type || file.item_type || 'File';
  }

  function materialName(file: any) {
    return file._nameLabel || file.name || file.item_name || file.fileName || '';
  }

  function materialSummary(file: any) {
    const type = materialType(file);
    const name = materialName(file);
    return name ? `${type}: ${name}` : type;
  }

  function visibleFolderSegmentsForFile(file: any) {
    // Prefer the on-screen folder path. The catalog path can contain a hidden
    // top-level "Content" wrapper from the Mac database, which should not be
    // treated as the print-rule root. Falling back keeps this safe for any future
    // root-level file displays.
    if (navPath.length) return navPath;
    return normalizePrintFolderSegments(file?.folderSegments || []);
  }

  function printModeForFile(file: any, activeSettings: PrintSettings = printSettings): PrintColorMode {
    return resolvePrintMode(activeSettings, visibleFolderSegmentsForFile(file), materialType(file));
  }

  function printRuleForFile(file: any) {
    return resolvePrintRuleKey(visibleFolderSegmentsForFile(file), materialType(file));
  }

  async function confirmDuplicatePrint(payload: any, studentName: string) {
    try {
      const res = await fetch('/api/check-duplicate-print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const json = await res.json().catch(() => ({}));
      const duplicates = Array.isArray(json?.duplicates) ? json.duplicates : [];
      if (!duplicates.length) return true;
      const first = duplicates[0];
      const by = first.tutor || 'another tutor';
      const ago = first.minutesAgo === 0 ? 'just now' : `${first.minutesAgo} minute${first.minutesAgo === 1 ? '' : 's'} ago`;
      const isFolderPrint = payload.kind === 'print-topic';
      const materialLabel = payload.names?.[0] || payload.name || 'this material';
      const contextLabel = payload.folder || '';
      const heading = isFolderPrint ? 'This folder was already printed' : 'This exact material was already printed';
      const detail = isFolderPrint
        ? contextLabel
        : [materialLabel, contextLabel].filter(Boolean).join('\n');
      return window.confirm(
        `${heading} for ${studentName} ${ago} by ${by}.\n\n${detail}\n\nPrint again?`
      );
    } catch {
      return true;
    }
  }

  async function queueFiles(selectedFiles: any[], folderPrint: boolean) {
    if (printingRef.current) return;
    if (!student) { setNeedStudent(true); return; }
    if (!selectedFiles.length) return;
    printingRef.current = true;
    setBusy(true); setMsg('');
    // Snapshot the student, copies and colours before the first await. Tutors can then browse
    // another folder/student while the queued batch keeps its original details.
    const folder = currentFolderMeta();
    const who = student, memberId = studentId, copies = qty;
    const items: PrintItem[] = selectedFiles.map(file => {
      const mode = printModeForFile(file);
      const name = materialName(file), type = materialType(file), path = materialPath(file);
      return {
        student: who, studentId: memberId, label: name || file.fileName, materialId: file.id, path,
        payload: { material_id: file.id, qty: copies, meta: { student: who, tutor: folder.tutor, folder: folder.folder }, ...buildPrintColorPayload(mode) },
        log: { ...folder, student: who, studentId: memberId, qty: copies, type, name, names: [name], type_labels: [type], materials: [materialSummary(file)],
          material_id: file.id, material_ids: [file.id], material_path: path, material_paths: path ? [path] : [],
          printColorMode: mode, print_color_mode: cupsPrintColorMode(mode), colorModeLabel: printModeLabel(mode), print_rule: printRuleForFile(file) },
      };
    });
    try {
      const proceed = await confirmDuplicatePrint({ kind: folderPrint ? 'print-topic' : 'print', student: who, studentId: memberId, folder: folder.folder,
        material_ids: items.map(item => item.materialId), material_paths: items.map(item => item.path).filter(Boolean), names: items.map(item => item.label), windowMinutes: 20 }, who);
      if (!proceed) { setMsg('Print cancelled.'); return; }
      enqueue({ label: `${who} · ${folderPrint ? folder.folder || 'Selected folder' : items[0].label}`, source: 'manual', items });
    } catch (error: any) { setMsg(error?.message || 'Could not add this print job.'); }
    finally { printingRef.current = false; setBusy(false); }
  }
  const printOne = (file: any) => queueFiles([file], false);
  const printFolderAll = () => queueFiles(files, true);

  const heading = (() => {
    const depth = navPath.length;
    if (depth === 0) return 'Select a Year';
    if (isStandardYearLabel(rootLabel)) {
      if (depth === 1) return 'Select a Subject';
      if (depth === 2) return 'Select a Strand';
      if (depth === 3) return 'Select Content';
    }
    return 'Select a Folder';
  })();

  return (
    <div>
      <div ref={topRef} />
      <Header />


      {/* Student required dialog */}
      {needStudent && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setNeedStudent(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(6px)'
          }}
        >
          <div className="card" style={{ maxWidth: 520, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div className="section-title" style={{ marginBottom: 8 }}>Enter student name</div>
            <div className="text-muted" style={{ marginBottom: 16 }}>
              Please enter or select a student name before sending anything to the printer.
            </div>
            <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-primary" onClick={() => setNeedStudent(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      <main className="container manual-print-page">
        <div className="card">
          <div className="flex items-center justify-between">
            <div className="badge-success">{status}</div>
            {msg && <div className="text-sm text-muted" style={{ marginLeft: 12 }}>{msg}</div>}
          </div>

          <div className="mt-3">
            <label className="label">Student</label>
            <StudentPicker value={student} onChange={value => { setStudent(value); setStudentId(''); }} onPronouns={setPronouns}
              onStudentPick={picked => { if (picked) { setStudentId(picked.id || ''); rememberRecentStudent(picked); setRecentRefreshKey(key => key + 1); } }}
              allowCustom customLabel="Use new student" onCustomPick={name => { setStudentId(''); rememberRecentStudent({ name }); setRecentRefreshKey(key => key + 1); }} required />
            <RecentStudents refreshKey={recentRefreshKey} onSelect={applyRecentStudent} />
            {student && <StudentPrintHistory key={`${studentId}|${student}`} student={student} studentId={studentId} />}
          </div>
          <div className="print-compact-options mt-3">
            <label>Copies <input className="input" aria-label="Copies" type="number" min={1} max={50} value={qty} onChange={event => {
              const count = parseInt(event.target.value, 10); setQty(Number.isFinite(count) ? Math.min(50, Math.max(1, count)) : 1);
            }} /></label>
            <label className="print-stamp-toggle"><input type="checkbox" checked={stampEnabled} disabled={!stampLoaded || !stampCanToggle || stampSaving || hasActive} onChange={() => changeStampEnabled(!stampEnabled)} /> Add student name</label>
            <details className="print-settings-details"><summary>Print settings</summary>
              <p>Student names appear on page 1. Diagnostic tests are left unstamped.</p>
              <p>{stampStatusMsg}</p>
              <p>Colour rules: {compactPrintSettingsSummary(printSettings)}{settingsMsg ? ` (${settingsMsg})` : ''}</p>
            </details>
          </div>

	          {dropdownLevels.length > 0 && (
	            <div className="mt-4 desktop-only">
	              <div
	                className="grid grid-col"
	                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
	              >
	                {dropdownLevels.map((lvl, idx) => (
	                  <div key={idx}>
	                    <div className="label">{lvl.label}</div>
	                    <select
	                      className="input"
	                      value={lvl.value}
	                      onChange={(e) => setDropdownAt(idx, e.target.value)}
	                    >
	                      <option value="">Select…</option>
	                      {lvl.options.map((opt) => (
	                        <option key={opt} value={opt}>
	                          {opt}
	                        </option>
	                      ))}
	                    </select>
	                  </div>
	                ))}
	                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
	                  <button className="btn w-full" onClick={scrollSelection}>Go to selection</button>
	                </div>
	              </div>

	            </div>
	          )}

          {/* Breadcrumb */}
          <div className="mt-4" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn" onClick={refresh}>Refresh</button>
            <button className="btn" onClick={clearAll}>Reset selection</button>
            {navPath.length > 0 && (
              <div className="text-sm text-muted" style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {navPath.map((seg, idx) => (
                  <button
                    key={seg + idx}
                    className="btn"
                    style={{ padding: '.35rem .65rem', borderRadius: 999, opacity: idx === navPath.length - 1 ? 1 : 0.85 }}
                    onClick={() => setNavPath(navPath.slice(0, idx + 1))}
                  >
                    {seg}
                  </button>
                ))}
                <button className="btn" style={{ padding: '.35rem .65rem', borderRadius: 999 }} onClick={goBack}>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>

	        {/* Anchor so the “Go to selection” button scrolls to the browsing UI. */}
	        <div ref={selectionRef} />

        {/* Folder tiles */}
        {childNames.length > 0 && (
          <section className="card mt-6">
            <h2 className="section-title">{heading}</h2>
            <div className={`grid ${navPath.length === 0 ? 'grid-2' : 'grid-3'} grid-col`}>
              {childNames.map((name) => (
                <button
                  key={name}
                  className="tile p-6"
                  onClick={() => {
                    setMsg('');
                    setNavPath([...navPath, name]);
                  }}
                >
                  <div className="text-xl" style={{ fontWeight: 700 }}>{name}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Files in current folder */}
        {files.length > 0 && (
          <section className="card mt-6">
            <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
              <h2 className="section-title" style={{ margin: 0 }}>{navPath.join(' • ')}</h2>
              <button
                className="btn-primary"
                disabled={busy || !settingsLoaded}
                onClick={printFolderAll}
              >
                Print Folder
              </button>
            </div>

            <div className="head mt-2">
              <div>Type</div>
              <div>Name</div>
              <div style={{ textAlign: 'right' }}>Action</div>
            </div>

            {files.map((it) => {
              const mode = printModeForFile(it as any);
              return (
                <div key={it.id} className="row">
                  <div>
                    <div>{it._typeLabel || it.type || it.item_type || 'File'}</div>
                    <div className="text-sm text-muted">{printModeLabel(mode)}</div>
                  </div>
                  <div>{it._nameLabel || it.name || it.item_name || it.fileName}</div>
                  <div style={{ textAlign: 'right' }}>
                    <button className="btn-primary" disabled={busy || !settingsLoaded} onClick={() => printOne(it as any)}>
                      Print
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <footer className="container footer mt-8" style={{ textAlign: 'center' }}>
          © {process.env.NEXT_PUBLIC_CAMPUS_NAME || 'Success Tutoring'}
        </footer>
      </main>

    </div>
  );
}
