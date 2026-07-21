import type { NextApiRequest, NextApiResponse } from 'next';
import Papa from 'papaparse';
import { getAuthStatus } from '../../lib/auth';
import { requireAdmin } from '../../lib/adminAuth';
import { DEFAULT_PRINT_SETTINGS, PRINT_RULE_DEFINITIONS, mergePrintSettings, normalizePrintMode, settingsToRows } from '../../lib/printSettings';
import { overwriteSheetRows, privateSheetsConfigured, readSheetRows, sheetNames, spreadsheetIdFor } from '../../lib/googleSheets';
import type { PrintSettings, PrintRuleKey } from '../../lib/printSettings';

function norm(value: any) { return String(value || '').trim(); }
function lower(value: any) { return norm(value).toLowerCase(); }
function rowVal(row: any, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null && norm(row[key]) !== '') return norm(row[key]);
  return '';
}
function getSettingsCsvUrl() { return process.env.PRINT_SETTINGS_CSV_URL || process.env.PRINT_RULES_CSV_URL || process.env.NEXT_PUBLIC_PRINT_SETTINGS_CSV_URL || ''; }
function getSettingsWebhookUrl() { return process.env.PRINT_SETTINGS_WEBHOOK_URL || process.env.PRINT_RULES_WEBHOOK_URL || ''; }

function ruleKeyFromScope(scope: string, materialType: string): PrintRuleKey | '' {
  const s = lower(scope);
  const m = lower(materialType);
  if (['k10', 'kindy-year 10', 'kindy-year10', 'kindy to year 10'].includes(s)) {
    if (m === 'lesson' || m === 'lessons') return 'k10Lesson';
    if (m === 'revision' || m === 'revisions' || m === 'rev') return 'k10Revision';
    if (m === 'homework' || m === 'homeworks' || m === 'hw') return 'k10Homework';
    if (m === 'other' || m === 'assessment' || m === 'other / assessment' || m === 'other/assessment') return 'k10Other';
  }
  if (['nonstandard', 'other', 'other programs', 'custom'].includes(s)) {
    if (!m || m === 'default' || m === 'other') return 'nonstandardDefault';
  }
  return '';
}

function ruleKeyFromAny(value: string): PrintRuleKey | '' {
  const k = lower(value).replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, PrintRuleKey> = {
    k10lesson: 'k10Lesson', k10lessons: 'k10Lesson', lesson: 'k10Lesson', lessons: 'k10Lesson',
    k10revision: 'k10Revision', k10revisions: 'k10Revision', revision: 'k10Revision', revisions: 'k10Revision', rev: 'k10Revision',
    k10homework: 'k10Homework', k10homeworks: 'k10Homework', homework: 'k10Homework', homeworks: 'k10Homework', hw: 'k10Homework',
    k10other: 'k10Other', k10assessment: 'k10Other', otherassessment: 'k10Other', assessment: 'k10Other',
    nonstandarddefault: 'nonstandardDefault', otherprogramsdefault: 'nonstandardDefault', otherprogramdefault: 'nonstandardDefault', default: 'nonstandardDefault',
  };
  return aliases[k] || '';
}

function parseSettingsJson(value: any): Partial<PrintSettings> {
  const s = norm(value);
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    const out: Partial<PrintSettings> = {};
    for (const rule of PRINT_RULE_DEFINITIONS) if (parsed?.[rule.key] !== undefined) out[rule.key] = normalizePrintMode(parsed[rule.key]);
    return out;
  } catch { return {}; }
}

function applyRow(settings: Partial<PrintSettings>, row: any) {
  const fromScope = ruleKeyFromScope(rowVal(row, 'scope', 'Scope'), rowVal(row, 'materialType', 'MaterialType', 'material', 'Material'));
  if (fromScope) { settings[fromScope] = normalizePrintMode(rowVal(row, 'printMode', 'PrintMode', 'mode', 'Mode', 'value', 'Value')); return; }
  const fromKey = ruleKeyFromAny(rowVal(row, 'settingKey', 'SettingKey', 'key', 'Key', 'name', 'Name'));
  if (fromKey) { settings[fromKey] = normalizePrintMode(rowVal(row, 'printMode', 'PrintMode', 'mode', 'Mode', 'value', 'Value')); return; }
  for (const rule of PRINT_RULE_DEFINITIONS) if (row[rule.key] !== undefined && norm(row[rule.key]) !== '') settings[rule.key] = normalizePrintMode(row[rule.key]);
}

async function loadSettingsFromCsv(campusKey: string) {
  const readRows = async () => {
    if (privateSheetsConfigured()) {
      const rows = await readSheetRows(sheetNames.printSettings(), spreadsheetIdFor('PRINT_SETTINGS'));
      return { rows, configured: true, loaded: true, source: 'private-sheet' };
    }
    const url = getSettingsCsvUrl();
    if (!url) return { rows: [] as any[], configured: false, loaded: false, source: '' };
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { rows: [] as any[], configured: true, loaded: false, source: 'legacy-csv', warning: `settings CSV unavailable (${res.status})` };
    const text = await res.text();
    const parsed = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() });
    return { rows: parsed.data || [], configured: true, loaded: true, source: 'legacy-csv' };
  };

  try {
    const loaded = await readRows();
    if (!loaded.configured) return { settings: {} as Partial<PrintSettings>, rows: [] as any[], configured: false, loaded: false };
    const allRows = loaded.rows || [];
    const campus = lower(campusKey);
    const globalRows = allRows.filter((row) => { const c = lower(rowVal(row, 'campusKey', 'CampusKey', 'campus', 'Campus')); return !c || c === 'global' || c === 'default'; });
    const campusRows = allRows.filter((row) => { const c = lower(rowVal(row, 'campusKey', 'CampusKey', 'campus', 'Campus')); return campus && c === campus; });
    const selectedRows = campusRows.length ? [...globalRows, ...campusRows] : globalRows.length ? globalRows : allRows;
    const settings: Partial<PrintSettings> = {};
    for (const row of selectedRows) applyRow(settings, row);
    return { settings, rows: selectedRows, configured: true, loaded: loaded.loaded, source: loaded.source, warning: (loaded as any).warning || '' };
  } catch (e: any) {
    return { settings: {} as Partial<PrintSettings>, rows: [] as any[], configured: true, loaded: false, warning: e?.message ? `settings source unavailable (${e.message})` : 'settings source unavailable' };
  }
}

function sanitizeSettings(input: any) {
  const out: Partial<PrintSettings> = {};
  for (const rule of PRINT_RULE_DEFINITIONS) if (input?.[rule.key] !== undefined) out[rule.key] = normalizePrintMode(input[rule.key]);
  return mergePrintSettings(out);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const auth = await getAuthStatus(req);
    if (!auth.authed) return res.status(401).json({ ok: false, error: 'Login required' });
    const campusKey = auth.campus;
    const envSettings = parseSettingsJson(process.env.PRINT_SETTINGS_JSON);
    const csv = await loadSettingsFromCsv(campusKey);
    const settings = mergePrintSettings({ ...envSettings, ...csv.settings });
    return res.status(200).json({ ok: true, settings, defaults: DEFAULT_PRINT_SETTINGS, rules: PRINT_RULE_DEFINITIONS, campusKey, configured: { privateSheets: privateSheetsConfigured(), csv: !!getSettingsCsvUrl(), webhook: !!getSettingsWebhookUrl(), envJson: !!process.env.PRINT_SETTINGS_JSON }, loadedFromCsv: csv.loaded, warning: (csv as any).warning || '' });
  }
  if (req.method === 'POST') {
    const admin = await requireAdmin(req);
    if (!admin.isAdmin) return res.status(403).json({ ok: false, error: 'Admin access required' });
    const campusKey = norm(req.body?.campusKey || admin.campus);
    const settings = sanitizeSettings(req.body?.settings || {});
    const rows = settingsToRows(settings, campusKey, admin.tutor);
    const payload = { kind: 'print-settings', campusKey, tutor: admin.tutor, updatedBy: admin.tutor, updatedAt: new Date().toISOString(), settings, rows };
    try {
      if (privateSheetsConfigured()) {
        const existing = await readSheetRows(sheetNames.printSettings(), spreadsheetIdFor('PRINT_SETTINGS')).catch(() => [] as any[]);
        const incomingKeys = new Set<string>(rows.map((row) => String(row.settingKey)));
        const kept = (existing || []).filter((row: any) => {
          const c = lower(rowVal(row, 'campusKey', 'CampusKey', 'campus', 'Campus'));
          const k = norm(rowVal(row, 'settingKey', 'SettingKey', 'key', 'Key'));
          return !(c === lower(campusKey) && incomingKeys.has(k));
        });
        await overwriteSheetRows(sheetNames.printSettings(), ['campusKey', 'scope', 'materialType', 'printMode', 'settingKey', 'updatedBy', 'updatedAt'], [...kept, ...rows], spreadsheetIdFor('PRINT_SETTINGS'));
        return res.status(200).json({ ok: true, settings, campusKey, saved: 'private-sheet' });
      }

      const webhook = getSettingsWebhookUrl();
      if (!webhook) return res.status(400).json({ ok: false, error: 'Private Sheets or PRINT_SETTINGS_WEBHOOK_URL is not configured, so settings cannot be saved yet.' });
      const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const text = await r.text();
      let parsed: any = {};
      try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
      if (!r.ok || parsed?.ok === false) return res.status(502).json({ ok: false, error: parsed?.error || `settings webhook failed (${r.status})`, detail: parsed });
      return res.status(200).json({ ok: true, settings, campusKey, webhook: parsed });
    } catch (e: any) { return res.status(502).json({ ok: false, error: e?.message || 'Could not save print settings' }); }
  }
  return res.status(405).end();
}
