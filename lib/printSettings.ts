export type PrintColorMode = 'colour' | 'bw';
export type PrintRuleKey = 'k10Lesson' | 'k10Revision' | 'k10Homework' | 'k10Other' | 'nonstandardDefault';
export type PrintSettings = Record<PrintRuleKey, PrintColorMode>;

export type PrintRuleDefinition = {
  key: PrintRuleKey;
  area: string;
  material: string;
  description: string;
  defaultMode: PrintColorMode;
  scope: 'k10' | 'nonstandard';
  materialType: 'lesson' | 'revision' | 'homework' | 'other' | 'default';
};

export const PRINT_RULE_DEFINITIONS: PrintRuleDefinition[] = [
  { key: 'k10Lesson', area: 'Kindy-Year 10', material: 'Lessons', description: 'Lesson files such as L1, Lesson 1, Lesson 2.', defaultMode: 'colour', scope: 'k10', materialType: 'lesson' },
  { key: 'k10Revision', area: 'Kindy-Year 10', material: 'Revisions', description: 'Revision files such as R1, Revision 1, Rev 2.', defaultMode: 'bw', scope: 'k10', materialType: 'revision' },
  { key: 'k10Homework', area: 'Kindy-Year 10', material: 'Homework', description: 'Homework files such as H1, HW1, Homework 1.', defaultMode: 'bw', scope: 'k10', materialType: 'homework' },
  { key: 'k10Other', area: 'Kindy-Year 10', material: 'Other / Assessment', description: 'Assessments or any other file that is not a lesson, revision, or homework.', defaultMode: 'colour', scope: 'k10', materialType: 'other' },
  { key: 'nonstandardDefault', area: 'Other programs', material: 'Default', description: 'Selective, OC, NAPLAN, exams, holiday programs, and other non-K-10 folders.', defaultMode: 'colour', scope: 'nonstandard', materialType: 'default' },
];

export const DEFAULT_PRINT_SETTINGS: PrintSettings = PRINT_RULE_DEFINITIONS.reduce((acc, rule) => {
  acc[rule.key] = rule.defaultMode;
  return acc;
}, {} as PrintSettings);

export function normalizePrintMode(value: any): PrintColorMode {
  const raw = String(value || '').trim().toLowerCase();
  if (['bw', 'b/w', 'b&w', 'blackwhite', 'black_white', 'black-white', 'black/white', 'black-and-white', 'black and white', 'black & white', 'mono', 'monochrome', 'grayscale', 'greyscale', 'gray', 'grey', 'false', '0'].includes(raw)) return 'bw';
  return 'colour';
}

export function printModeLabel(mode: PrintColorMode) { return mode === 'bw' ? 'Black & White' : 'Colour'; }
export function cupsPrintColorMode(mode: PrintColorMode) { return mode === 'bw' ? 'monochrome' : 'color'; }

export function isK10ProgramRoot(label: string) {
  const l = String(label || '').trim().toLowerCase();
  if (l === 'kindy' || l === 'kindergarten' || l === 'k') return true;
  const m = l.match(/^year\s*(\d{1,2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  return Number.isFinite(year) && year >= 1 && year <= 10;
}

function normalizeMaterialType(typeLabel: string) {
  const t = String(typeLabel || '').trim().toLowerCase();
  if (t.includes('lesson')) return 'lesson';
  if (t.includes('revision') || t === 'rev') return 'revision';
  if (t.includes('homework') || t === 'hw' || t === 'hwk') return 'homework';
  return 'other';
}

export function normalizePrintFolderSegments(folderSegments: string[] | null | undefined) {
  const parts = (folderSegments || []).map((part) => String(part || '').trim()).filter(Boolean);
  while (parts.length && ['content', 'contents', 'print content', 'tutoringprints'].includes(parts[0].toLowerCase())) {
    parts.shift();
  }
  return parts;
}

export function resolvePrintRuleKey(folderSegments: string[], typeLabel: string): PrintRuleKey {
  const cleanSegments = normalizePrintFolderSegments(folderSegments);
  const root = cleanSegments[0] || '';
  if (!isK10ProgramRoot(root)) return 'nonstandardDefault';
  const materialType = normalizeMaterialType(typeLabel);
  if (materialType === 'lesson') return 'k10Lesson';
  if (materialType === 'revision') return 'k10Revision';
  if (materialType === 'homework') return 'k10Homework';
  return 'k10Other';
}

export function mergePrintSettings(input: Partial<PrintSettings> | null | undefined): PrintSettings {
  const merged: PrintSettings = { ...DEFAULT_PRINT_SETTINGS };
  for (const rule of PRINT_RULE_DEFINITIONS) {
    const value = (input || {})[rule.key];
    if (value) merged[rule.key] = normalizePrintMode(value);
  }
  return merged;
}

export function resolvePrintMode(settings: Partial<PrintSettings> | null | undefined, folderSegments: string[], typeLabel: string): PrintColorMode {
  const merged = mergePrintSettings(settings || {});
  const key = resolvePrintRuleKey(folderSegments, typeLabel);
  return merged[key];
}

export function settingsToRows(settings: Partial<PrintSettings> | null | undefined, campusKey = '', updatedBy = '') {
  const merged = mergePrintSettings(settings || {});
  const updatedAt = new Date().toISOString();
  return PRINT_RULE_DEFINITIONS.map((rule) => ({
    campusKey,
    scope: rule.scope,
    materialType: rule.materialType,
    printMode: merged[rule.key],
    settingKey: rule.key,
    updatedBy,
    updatedAt,
  }));
}

export function buildPrintColorPayload(mode: PrintColorMode) {
  const mono = mode === 'bw';
  const cupsMode = cupsPrintColorMode(mode);
  return {
    printColorMode: mode,
    print_color_mode: cupsMode,
    color_mode: cupsMode,
    black_white: mono,
    blackWhite: mono,
    grayscale: mono,
    greyscale: mono,
    monochrome: mono,
    color: !mono,
    colour: !mono,
    print_options: { printColorMode: mode, print_color_mode: cupsMode, color_mode: cupsMode, black_white: mono, blackWhite: mono, grayscale: mono, greyscale: mono, monochrome: mono, color: !mono, colour: !mono },
    options: { color: !mono, colour: !mono, grayscale: mono, greyscale: mono, monochrome: mono, color_mode: cupsMode },
  };
}

export function compactPrintSettingsSummary(settings: Partial<PrintSettings> | null | undefined) {
  const merged = mergePrintSettings(settings || {});
  return PRINT_RULE_DEFINITIONS.map((rule) => `${rule.material}: ${printModeLabel(merged[rule.key])}`).join(' • ');
}
