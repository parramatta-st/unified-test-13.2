import Papa from "papaparse";
import {
  loadRowsPrivateFirst,
  overwriteSheetRows,
  privateSheetsConfigured,
  sheetNames,
  spreadsheetIdFor,
} from "./googleSheets";

export type TutorRole = "admin" | "tutor";

export type TutorConfig = {
  campusKey: string;
  campusName: string;
  tutorName: string;
  role: TutorRole;
  active: boolean;
  email: string;
};

export type TutorConfigLoadMeta = {
  tutors: TutorConfig[];
  source: string;
  configured: boolean;
  privateConfigured: boolean;
  warning: string;
  sheetName: string;
  spreadsheetId: string;
};

function maskSpreadsheetId(id: string) {
  const value = norm(id);
  if (!value) return "";
  if (value.length <= 10) return value;
  return value.slice(0, 6) + "..." + value.slice(-4);
}

export const TUTOR_HEADERS = [
  "campusKey",
  "tutorName",
  "role",
  "active",
  "email",
  "campusName",
];

function norm(v: any) {
  return String(v ?? "").trim();
}
function lower(v: any) {
  return norm(v).toLowerCase();
}
function keyName(v: any) {
  return lower(v)
    .replace(/^\ufeff/, "")
    .replace(/[^a-z0-9]+/g, "");
}
function readValue(row: any, ...keys: string[]) {
  for (const key of keys)
    if (
      row?.[key] !== undefined &&
      row?.[key] !== null &&
      norm(row[key]) !== ""
    )
      return norm(row[key]);
  const wanted = new Set(keys.map(keyName));
  for (const [rawKey, value] of Object.entries(row || {})) {
    if (
      wanted.has(keyName(rawKey)) &&
      value !== undefined &&
      value !== null &&
      norm(value) !== ""
    )
      return norm(value);
  }
  return "";
}

function truthyActive(v: any) {
  const s = lower(v);
  if (!s) return true;
  return ["true", "yes", "y", "1", "active", "enabled"].includes(s);
}

function roleOf(v: any): TutorRole {
  return lower(v).includes("admin") ? "admin" : "tutor";
}

function splitAdmins(value: string) {
  return (value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function firstCampusFromEnv() {
  const raw = process.env.NEXT_PUBLIC_CAMPUSES_JSON || "";
  try {
    const parsed = JSON.parse(raw || "[]");
    const campuses = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const first = campuses[0] || {};
    const id = norm(first.id || first.campusKey || "").toLowerCase();
    const name = norm(first.name || first.campusName || id);
    if (id) return { id, name: name || id };
  } catch {}
  return { id: "parramatta", name: "Parramatta" };
}

export function defaultCampusKey() {
  return firstCampusFromEnv().id;
}

export function defaultCampusName() {
  return firstCampusFromEnv().name;
}

function normalizeRow(row: any): TutorConfig | null {
  const tutorName = readValue(
    row,
    "tutorName",
    "TutorName",
    "Tutor Name",
    "tutor",
    "Tutor",
    "name",
    "Name",
  );
  if (!tutorName) return null;
  const campusKey = (
    readValue(
      row,
      "campusKey",
      "CampusKey",
      "Campus Key",
      "campus",
      "Campus",
    ) || defaultCampusKey()
  ).toLowerCase();
  const campusName =
    readValue(
      row,
      "campusName",
      "CampusName",
      "Campus Name",
      "centreName",
      "CentreName",
      "Centre Name",
      "centerName",
      "CenterName",
      "Center Name",
    ) || (campusKey === defaultCampusKey() ? defaultCampusName() : campusKey);
  return {
    campusKey,
    campusName,
    tutorName,
    role: roleOf(readValue(row, "role", "Role")),
    active: truthyActive(
      readValue(
        row,
        "active",
        "Active",
        "enabled",
        "Enabled",
        "status",
        "Status",
      ),
    ),
    email: readValue(row, "email", "Email"),
  };
}

function fromCampusesJson(): TutorConfig[] {
  const raw = process.env.NEXT_PUBLIC_CAMPUSES_JSON || "";
  const admins = splitAdmins(
    process.env.ADMIN_TUTORS || process.env.NEXT_PUBLIC_ADMIN_TUTORS || "",
  );
  try {
    const campuses = JSON.parse(raw || "[]");
    if (!Array.isArray(campuses)) return [];
    const out: TutorConfig[] = [];
    for (const campus of campuses) {
      const campusKey = norm(
        campus.id || campus.campusKey || defaultCampusKey(),
      ).toLowerCase();
      const campusName = norm(campus.name || campus.campusName || campusKey);
      const tutors = Array.isArray(campus.tutors) ? campus.tutors : [];
      for (const t of tutors) {
        const tutorName = norm(t);
        if (!tutorName) continue;
        const clean = tutorName.toLowerCase();
        const first = clean.split(/\s+/)[0];
        out.push({
          campusKey,
          campusName,
          tutorName,
          role:
            admins.includes(clean) || admins.includes(first)
              ? "admin"
              : "tutor",
          active: true,
          email: "",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function fromInlineJson(): TutorConfig[] {
  const raw =
    process.env.TUTOR_CONFIG_JSON ||
    process.env.NEXT_PUBLIC_TUTOR_CONFIG_JSON ||
    "";
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data.tutors)
        ? data.tutors
        : [];
    return rows.map(normalizeRow).filter(Boolean) as TutorConfig[];
  } catch {
    return [];
  }
}

export function tutorConfigUrl() {
  return (
    process.env.TUTOR_CONFIG_CSV_URL ||
    process.env.NEXT_PUBLIC_TUTOR_CONFIG_CSV_URL ||
    ""
  );
}

async function loadTutorConfigFromCsv(): Promise<TutorConfig[]> {
  const url = tutorConfigUrl();
  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        const parsed = Papa.parse<Record<string, any>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
        });
        const rows = (parsed.data || [])
          .map(normalizeRow)
          .filter(Boolean) as TutorConfig[];
        if (rows.length) return rows;
      }
    } catch (error) {
      console.error("Failed to load tutor config CSV", error);
    }
  }
  return [];
}

export async function loadTutorConfigWithMeta(): Promise<TutorConfigLoadMeta> {
  const inline = fromInlineJson();
  if (inline.length) {
    return {
      tutors: inline,
      source: "inline-json",
      configured: true,
      privateConfigured: privateSheetsConfigured(),
      warning: "",
      sheetName: "TUTOR_CONFIG_JSON",
      spreadsheetId: "",
    };
  }

  const sheetName = sheetNames.tutors();
  const spreadsheetId = spreadsheetIdFor("TUTOR_CONFIG");
  const csvUrl = tutorConfigUrl();

  if (privateSheetsConfigured() || csvUrl) {
    const result = await loadRowsPrivateFirst({
      kind: "TUTOR_CONFIG",
      sheetName,
      csvUrls: csvUrl ? [csvUrl] : [],
      spreadsheetId,
    });
    const rows = (result.rows || [])
      .map(normalizeRow)
      .filter(Boolean) as TutorConfig[];
    return {
      tutors: rows,
      source: result.source || (privateSheetsConfigured() ? "private-sheet" : "legacy-csv"),
      configured: result.configured,
      privateConfigured: result.privateConfigured,
      warning: result.warning || "",
      sheetName,
      spreadsheetId: maskSpreadsheetId(spreadsheetId),
    };
  }

  const fallback = fromCampusesJson();
  return {
    tutors: fallback,
    source: fallback.length ? "campuses-json" : "none",
    configured: fallback.length > 0,
    privateConfigured: privateSheetsConfigured(),
    warning: fallback.length
      ? "Loaded tutors from NEXT_PUBLIC_CAMPUSES_JSON fallback."
      : "No tutor config source found. Configure private Google Sheets or add tutors to NEXT_PUBLIC_CAMPUSES_JSON.",
    sheetName,
    spreadsheetId: maskSpreadsheetId(spreadsheetId),
  };
}

export async function loadTutorConfig(): Promise<TutorConfig[]> {
  const meta = await loadTutorConfigWithMeta();
  return meta.tutors;
}

export function hasTutorConfigSource() {
  return !!(
    process.env.TUTOR_CONFIG_JSON ||
    process.env.NEXT_PUBLIC_TUTOR_CONFIG_JSON ||
    tutorConfigUrl() ||
    privateSheetsConfigured()
  );
}

export async function saveTutorConfig(rows: TutorConfig[]) {
  if (!privateSheetsConfigured())
    throw new Error(
      "Private Google Sheets is required to save tutors. Configure the service account first.",
    );
  const out = rows.map((t) => ({
    campusKey: t.campusKey,
    tutorName: t.tutorName,
    role: t.role,
    active: t.active ? "TRUE" : "FALSE",
    email: t.email || "",
    campusName: t.campusName || t.campusKey,
  }));
  await overwriteSheetRows(
    sheetNames.tutors(),
    TUTOR_HEADERS,
    out,
    spreadsheetIdFor("TUTOR_CONFIG"),
  );
}

export function cleanTutorInput(
  input: any,
  existing?: TutorConfig,
): TutorConfig {
  const campusKey =
    lower(
      readValue(
        input,
        "campusKey",
        "CampusKey",
        "Campus Key",
        "campus",
        "Campus",
      ) ||
        existing?.campusKey ||
        defaultCampusKey(),
    ) || defaultCampusKey();
  const campusName =
    readValue(
      input,
      "campusName",
      "CampusName",
      "Campus Name",
      "centreName",
      "CentreName",
      "Centre Name",
      "centerName",
      "CenterName",
      "Center Name",
    ) ||
    existing?.campusName ||
    (campusKey === defaultCampusKey() ? defaultCampusName() : campusKey);
  const tutorName =
    readValue(
      input,
      "tutorName",
      "TutorName",
      "Tutor Name",
      "tutor",
      "Tutor",
      "name",
      "Name",
    ) ||
    existing?.tutorName ||
    "";
  const role = roleOf(
    readValue(input, "role", "Role") || existing?.role || "tutor",
  );
  const activeRaw = readValue(
    input,
    "active",
    "Active",
    "enabled",
    "Enabled",
    "status",
    "Status",
  );
  const active =
    activeRaw === "" && input?.active === undefined
      ? (existing?.active ?? true)
      : truthyActive(activeRaw || input?.active);
  const email = readValue(input, "email", "Email") || existing?.email || "";
  if (!tutorName) throw new Error("Tutor name is required");
  return { campusKey, campusName, tutorName, role, active, email };
}

export async function getActiveTutors(campusKey?: string) {
  const key = lower(campusKey || "");
  const rows = await loadTutorConfig();
  return rows
    .filter((t) => t.active)
    .filter((t) => !key || t.campusKey === key)
    .sort((a, b) => a.tutorName.localeCompare(b.tutorName));
}

export async function findTutor(tutorName: string, campusKey?: string) {
  const name = lower(tutorName);
  const first = name.split(/\s+/)[0];
  if (!name) return null;
  const rows = await loadTutorConfig();
  const key = lower(campusKey || "");
  return (
    rows.find((t) => {
      if (key && t.campusKey !== key) return false;
      const clean = lower(t.tutorName);
      const firstClean = clean.split(/\s+/)[0];
      return (
        clean === name ||
        firstClean === name ||
        clean === first ||
        firstClean === first
      );
    }) || null
  );
}

export async function isAdminTutor(tutorName: string, campusKey?: string) {
  const tutor = await findTutor(tutorName, campusKey);
  if (tutor) return tutor.active && tutor.role === "admin";

  const clean = lower(tutorName);
  const first = clean.split(/\s+/)[0];
  const admins = splitAdmins(
    process.env.ADMIN_TUTORS || process.env.NEXT_PUBLIC_ADMIN_TUTORS || "",
  );
  return !!clean && (admins.includes(clean) || admins.includes(first));
}

export function uniqueCampuses(tutors: TutorConfig[]) {
  const map = new Map<string, { id: string; name: string }>();
  for (const t of tutors) {
    if (!map.has(t.campusKey))
      map.set(t.campusKey, {
        id: t.campusKey,
        name: t.campusName || t.campusKey,
      });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
