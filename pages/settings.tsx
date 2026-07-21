import Link from 'next/link';
import { useEffect, useState } from 'react';
import Header from '../components/Header';
import useAuthGuard from '../hooks/useAuthGuard';
import type { PrintColorMode, PrintSettings, PrintRuleKey } from '../lib/printSettings';
import { DEFAULT_PRINT_SETTINGS, PRINT_RULE_DEFINITIONS, mergePrintSettings, printModeLabel } from '../lib/printSettings';

type SettingsApiResponse = { ok?: boolean; error?: string; settings?: Partial<PrintSettings>; campusKey?: string; configured?: { privateSheets?: boolean; csv?: boolean; webhook?: boolean; envJson?: boolean }; loadedFromCsv?: boolean; warning?: string };

function ModeToggle({ value, onChange }: { value: PrintColorMode; onChange: (mode: PrintColorMode) => void }) {
  return <div className="segmented" role="group" aria-label="Print mode"><button type="button" className={`seg-btn ${value === 'colour' ? 'active' : ''}`} onClick={() => onChange('colour')}>Colour</button><button type="button" className={`seg-btn ${value === 'bw' ? 'active' : ''}`} onClick={() => onChange('bw')}>Black &amp; White</button></div>;
}

export default function SettingsPage() {
  useAuthGuard();
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS);
  const [campusKey, setCampusKey] = useState('');
  const [configured, setConfigured] = useState<SettingsApiResponse['configured']>({});
  const [loadedFromCsv, setLoadedFromCsv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  async function load() {
    setLoading(true); setError(''); setMessage(''); setWarning('');
    try {
      const statusRes = await fetch('/api/admin-status', { cache: 'no-store' });
      const status = await statusRes.json().catch(() => ({}));
      setAdminChecked(true); setIsAdmin(!!status?.isAdmin);
      if (!status?.isAdmin) { setLoading(false); return; }
      const res = await fetch('/api/print-settings', { cache: 'no-store' });
      const json: SettingsApiResponse = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not load print settings');
      setSettings(mergePrintSettings(json.settings || {}));
      setCampusKey(json.campusKey || '');
      setConfigured(json.configured || {});
      setLoadedFromCsv(!!json.loadedFromCsv);
      setWarning(json.warning || '');
    } catch (e: any) { setError(e?.message || 'Could not load print settings'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  function updateMode(key: PrintRuleKey, mode: PrintColorMode) { setSettings((prev) => mergePrintSettings({ ...prev, [key]: mode })); setMessage(''); }
  function resetDefaults() { setSettings(DEFAULT_PRINT_SETTINGS); setMessage('Recommended defaults restored. Press Save settings to apply them globally.'); }
  async function save() {
    setSaving(true); setError(''); setMessage('');
    try {
      const res = await fetch('/api/print-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campusKey, settings }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Could not save print settings');
      setSettings(mergePrintSettings(json.settings || settings));
      setMessage('Print colour settings saved. Refresh the Print page to use the latest rules.');
    } catch (e: any) { setError(e?.message || 'Could not save print settings'); } finally { setSaving(false); }
  }

  return <div><Header /><main className="container"><div className="card"><div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}><div><h2 className="section-title">Print Colour Settings</h2><p className="text-muted" style={{ marginTop: 0 }}>Control whether each material type prints in colour or black and white. These rules apply when tutors print one file or a whole folder.</p></div><div className="flex gap-2" style={{ flexWrap: 'wrap' }}><Link href="/admin" className="btn" prefetch={false}>Back to Admin</Link><button className="btn" onClick={load} disabled={loading || saving}>{loading ? 'Refreshing…' : 'Refresh'}</button></div></div>
    {adminChecked && !isAdmin && <section className="card mt-4"><h3 className="section-title" style={{ fontSize: '1.2rem' }}>Admin access required</h3><p className="text-muted">Only tutors with admin access in the tutor config sheet can change print colour settings.</p></section>}
    {isAdmin && <><section className="card mt-4"><h3 className="section-title" style={{ fontSize: '1.2rem' }}>Current setup</h3><div className="grid grid-col" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}><div className="admin-stat-card"><strong>{campusKey || 'Current campus'}</strong><span>Campus</span></div><div className="admin-stat-card"><strong>{configured?.privateSheets ? 'Private Sheet' : configured?.csv ? (loadedFromCsv ? 'Legacy CSV' : 'CSV configured') : 'Defaults'}</strong><span>Settings source</span></div><div className="admin-stat-card"><strong>{configured?.privateSheets ? 'Private Sheet' : configured?.webhook ? 'Webhook' : 'Not configured'}</strong><span>Save method</span></div></div>{!configured?.privateSheets && !configured?.csv && <p className="text-sm text-muted mt-3">No print settings sheet is configured yet, so the portal is using the recommended defaults below.</p>}{!configured?.privateSheets && !configured?.webhook && <p className="text-sm mt-3" style={{ color: '#fbbf24' }}>Private Google Sheets or PRINT_SETTINGS_WEBHOOK_URL is required before these settings can be saved globally.</p>}{warning && <p className="text-sm mt-3" style={{ color: '#fbbf24' }}>{warning}</p>}</section>
    <section className="card mt-4"><div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}><div><h3 className="section-title" style={{ fontSize: '1.2rem', marginBottom: 4 }}>Rules</h3><p className="text-muted" style={{ marginTop: 0 }}>Recommended defaults: Lessons in colour, Revisions and Homework in black and white, Other/Assessment in colour, Other programs in colour.</p></div><button className="btn" onClick={resetDefaults} disabled={saving}>Restore recommended defaults</button></div><div className="head mt-4" style={{ gridTemplateColumns: '2fr 2fr 3fr' }}><div>Area</div><div>Material</div><div>Print mode</div></div>{PRINT_RULE_DEFINITIONS.map((rule) => <div className="row" key={rule.key} style={{ gridTemplateColumns: '2fr 2fr 3fr', alignItems: 'center' }}><div><strong>{rule.area}</strong><div className="text-sm text-muted">Default: {printModeLabel(rule.defaultMode)}</div></div><div><strong>{rule.material}</strong><div className="text-sm text-muted">{rule.description}</div></div><div><ModeToggle value={settings[rule.key]} onChange={(mode) => updateMode(rule.key, mode)} /></div></div>)}{error && <div className="mt-4" style={{ color: '#fca5a5' }}>{error}</div>}{message && <div className="mt-4 badge-success">{message}</div>}<div className="flex gap-2 mt-4" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="btn" onClick={load} disabled={loading || saving}>Cancel changes</button><button className="btn-primary" onClick={save} disabled={saving || loading || !(configured?.privateSheets || configured?.webhook)}>{saving ? 'Saving…' : 'Save settings'}</button></div></section></>}
  </div></main></div>;
}
