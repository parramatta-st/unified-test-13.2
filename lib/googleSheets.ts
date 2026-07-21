import crypto from "crypto";

export type SheetRow = Record<string, any>;

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedAuthFailure: { message: string; expiresAt: number } | null = null;

function norm(value: any) {
  return String(value ?? "").trim();
}
function base64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function parseJsonEnv(raw: string) {
  const value = norm(raw);
  if (!value) return null;

  const tryParse = (input: string): any => {
    try {
      const parsed = JSON.parse(input);
      // Vercel dashboard values should be raw JSON, while .env files often wrap
      // the JSON in quotes. If JSON.parse returns a string, parse that string too.
      if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
        try { return JSON.parse(parsed); } catch { return parsed; }
      }
      return parsed;
    } catch {
      return null;
    }
  };

  const direct = tryParse(value);
  if (direct && typeof direct === "object") return direct;

  const unescaped = tryParse(value.replace(/\\n/g, "\n"));
  if (unescaped && typeof unescaped === "object") return unescaped;

  // Handles values accidentally pasted with escaped quotes, e.g. {\"type\":...}
  const deEscapedQuotes = tryParse(value.replace(/\\"/g, '"').replace(/\\n/g, "\n"));
  if (deEscapedQuotes && typeof deEscapedQuotes === "object") return deEscapedQuotes;

  return null;
}

function serviceAccountJson() {
  return parseJsonEnv(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_CREDENTIALS_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON ||
      "",
  );
}

function unquoteEnvString(raw: string) {
  let value = String(raw || "").trim();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    try {
      value = JSON.parse(value);
    } catch {
      value = inner;
    }
  }
  return value;
}

function normalisePrivateKey(raw: string) {
  let value = unquoteEnvString(raw);
  value = value.replace(/\\n/g, "\n").trim();
  return value;
}

export function serviceAccountEmail() {
  const json = serviceAccountJson();
  // Prefer the downloaded JSON when it is present. This prevents a stale
  // GOOGLE_SERVICE_ACCOUNT_EMAIL env var from being paired with a newer JSON key.
  return norm(
    json?.client_email ||
      json?.clientEmail ||
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      process.env.GOOGLE_CLIENT_EMAIL ||
      "",
  );
}

function privateKey() {
  const json = serviceAccountJson();
  // Prefer the downloaded JSON when it is present. Email/private-key mismatches
  // were the most common cause of Google "invalid_grant" setup errors.
  return normalisePrivateKey(
    json?.private_key ||
      json?.privateKey ||
      process.env.GOOGLE_PRIVATE_KEY ||
      "",
  );
}

export function privateSheetsConfigured() {
  return !!(
    serviceAccountEmail() &&
    privateKey() &&
    norm(process.env.GOOGLE_SHEETS_SPREADSHEET_ID)
  );
}

export function privateSheetsConfigSummary() {
  return {
    configured: privateSheetsConfigured(),
    email: serviceAccountEmail(),
    hasPrivateKey: !!privateKey(),
    hasJson: !!serviceAccountJson(),
    spreadsheetId: norm(process.env.GOOGLE_SHEETS_SPREADSHEET_ID),
  };
}

export function spreadsheetIdFor(kind?: string) {
  const key = String(kind || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  if (key) {
    const specific = norm(process.env[`${key}_SPREADSHEET_ID`]);
    if (specific) return specific;
  }
  return norm(process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
}

export const sheetNames = {
  contacts: () => norm(process.env.CONTACTS_SHEET_NAME) || "contacts",
  curriculum: () => norm(process.env.CURRICULUM_SHEET_NAME) || "curriculum",
  tutors: () => norm(process.env.TUTOR_CONFIG_SHEET_NAME) || "tutor_config",
  feedbackLog: () =>
    norm(process.env.FEEDBACK_LOG_SHEET_NAME) || "sentmsgs new",
  printLog: () => norm(process.env.PRINT_LOG_SHEET_NAME) || "print_log",
  printSettings: () =>
    norm(process.env.PRINT_SETTINGS_SHEET_NAME) || "print_settings",
};

function friendlyGoogleAuthError(error: any) {
  const msg = norm(
    error?.message || error?.error_description || error?.error || error,
  );
  if (/invalid_grant/i.test(msg) && /account not found/i.test(msg)) {
    return "Google service account was not found. Check that GOOGLE_SERVICE_ACCOUNT_EMAIL exactly matches the client_email in the downloaded service-account JSON, and that the service account has not been deleted.";
  }
  if (/invalid_grant/i.test(msg)) {
    return `Google service-account login failed. Check that GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY belong to the same downloaded JSON key. Details: ${msg}`;
  }
  if (/invalid.*pem|private key|decoder/i.test(msg)) {
    return `Google private key could not be read. The easiest fix is to use GOOGLE_SERVICE_ACCOUNT_JSON from the downloaded JSON key instead of manually copying the private key. Details: ${msg}`;
  }
  if (/permission|forbidden|caller does not have permission/i.test(msg)) {
    return `Google Sheet permission failed. Share the spreadsheet with ${serviceAccountEmail() || "the service account email"} as Editor. Details: ${msg}`;
  }
  return msg || "Google Sheets connection failed";
}

async function getAccessToken() {
  if (!privateSheetsConfigured())
    throw new Error(
      "Google private Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON, or set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEETS_SPREADSHEET_ID.",
    );
  const now = Date.now();
  if (cachedAuthFailure && cachedAuthFailure.expiresAt > now)
    throw new Error(cachedAuthFailure.message);
  if (cachedToken && cachedToken.expiresAt > now + 60_000)
    return cachedToken.token;

  const header = { alg: "RS256", typ: "JWT" };
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: serviceAccountEmail(),
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: iat + 3600,
    iat,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  let signature: Buffer;
  try {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    signature = signer.sign(privateKey());
  } catch (err: any) {
    const message = friendlyGoogleAuthError(err);
    cachedAuthFailure = { message, expiresAt: now + 30_000 };
    throw new Error(message);
  }
  const assertion = `${unsigned}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    const message = friendlyGoogleAuthError(
      json?.error_description ||
        json?.error ||
        `Google token request failed (${response.status})`,
    );
    cachedAuthFailure = { message, expiresAt: now + 30_000 };
    throw new Error(message);
  }
  cachedToken = {
    token: json.access_token,
    expiresAt: now + Math.max(60, Number(json.expires_in || 3600) - 30) * 1000,
  };
  cachedAuthFailure = null;
  return cachedToken.token;
}

async function sheetsFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    },
  );
  const text = await response.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const msg =
      json?.error?.message ||
      json?.error_description ||
      json?.error ||
      `Google Sheets API failed (${response.status})`;
    throw new Error(friendlyGoogleAuthError(msg));
  }
  return json;
}

function quoteSheetName(sheetName: string) {
  return `'${String(sheetName || "").replace(/'/g, "''")}'`;
}

function valuesPath(spreadsheetId: string, sheetName: string, range = "A:ZZ") {
  const a1 = `${quoteSheetName(sheetName)}!${range}`;
  return `${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1)}`;
}

function withValueInputOption(
  path: string,
  option: "RAW" | "USER_ENTERED" = "RAW",
) {
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}valueInputOption=${option}`;
}

async function clearSheetValues(
  sheetName: string,
  spreadsheetId: string,
  range = "A:ZZ",
) {
  await sheetsFetch(`${valuesPath(spreadsheetId, sheetName, range)}:clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

function columnName(indexOneBased: number) {
  let n = indexOneBased;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

function mergeHeaders(primary: string[], current: string[]) {
  const out = [...primary];
  for (const h of current) if (h && !out.includes(h)) out.push(h);
  return out;
}

export function rowsToObjects(values: any[][]): SheetRow[] {
  if (!values || !values.length) return [];
  const headers = (values[0] || []).map((h: any) => norm(h));
  return values
    .slice(1)
    .filter((row) => row.some((cell) => norm(cell) !== ""))
    .map((row) => {
      const obj: SheetRow = {};
      headers.forEach((header, idx) => {
        if (header) obj[header] = row[idx] ?? "";
      });
      return obj;
    });
}

export async function getSpreadsheet(spreadsheetId = spreadsheetIdFor()) {
  return sheetsFetch(
    `${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
  );
}

export async function ensureSheet(
  sheetName: string,
  spreadsheetId = spreadsheetIdFor(),
) {
  const meta = await getSpreadsheet(spreadsheetId);
  const titles = (meta.sheets || [])
    .map((s: any) => s?.properties?.title)
    .filter(Boolean);
  if (titles.includes(sheetName)) return;
  await sheetsFetch(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    }),
  });
}

export async function readSheetValues(
  sheetName: string,
  spreadsheetId = spreadsheetIdFor(),
) {
  const json = await sheetsFetch(valuesPath(spreadsheetId, sheetName), {
    method: "GET",
  });
  return (json.values || []) as any[][];
}

export async function readSheetRows(
  sheetName: string,
  spreadsheetId = spreadsheetIdFor(),
) {
  const values = await readSheetValues(sheetName, spreadsheetId);
  return rowsToObjects(values);
}

export async function overwriteSheetRows(
  sheetName: string,
  headers: string[],
  rows: SheetRow[],
  spreadsheetId = spreadsheetIdFor(),
) {
  await ensureSheet(sheetName, spreadsheetId);
  const existing = await readSheetValues(sheetName, spreadsheetId).catch(
    () => [] as any[][],
  );
  const values = [
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ];

  // Google Sheets values.update requires valueInputOption. RAW preserves emails,
  // IDs, and imported CSV text exactly instead of treating user input as formulas.
  await sheetsFetch(
    withValueInputOption(
      valuesPath(
        spreadsheetId,
        sheetName,
        `A1:${columnName(headers.length)}${Math.max(1, values.length)}`,
      ),
      "RAW",
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        range: `${quoteSheetName(sheetName)}!A1:${columnName(headers.length)}${Math.max(1, values.length)}`,
        majorDimension: "ROWS",
        values,
      }),
    },
  );

  // Clear old leftover rows/columns only after the new values are safely written.
  // This prevents stale imported rows from continuing to appear if the new list is shorter.
  if (existing.length > values.length) {
    await clearSheetValues(
      sheetName,
      spreadsheetId,
      `A${values.length + 1}:ZZ${existing.length}`,
    );
  }
  const widestExisting = existing.reduce(
    (max, row) => Math.max(max, row.length || 0),
    0,
  );
  if (widestExisting > headers.length) {
    await clearSheetValues(
      sheetName,
      spreadsheetId,
      `${columnName(headers.length + 1)}1:ZZ${Math.max(existing.length, values.length)}`,
    );
  }
}

export async function appendSheetRows(
  sheetName: string,
  headers: string[],
  rows: SheetRow[],
  spreadsheetId = spreadsheetIdFor(),
) {
  if (!rows.length) return { appended: 0 };
  await ensureSheet(sheetName, spreadsheetId);
  let existing: any[][] = [];
  try {
    existing = await readSheetValues(sheetName, spreadsheetId);
  } catch {
    existing = [];
  }
  let effectiveHeaders = headers;
  if (!existing.length) {
    await overwriteSheetRows(sheetName, headers, [], spreadsheetId);
  } else {
    const currentHeaders = (existing[0] || [])
      .map((h: any) => norm(h))
      .filter(Boolean);
    if (currentHeaders.length)
      effectiveHeaders = mergeHeaders(headers, currentHeaders);
  }
  const values = rows.map((row) =>
    effectiveHeaders.map((header) => row[header] ?? ""),
  );
  const path = `${valuesPath(spreadsheetId, sheetName, "A1:ZZ")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await sheetsFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  return { appended: rows.length };
}

export async function upsertSheetRowByKey(options: {
  sheetName: string;
  headers: string[];
  keyHeader: string;
  keyValue: string;
  row: SheetRow;
  spreadsheetId?: string;
}) {
  const spreadsheetId = options.spreadsheetId || spreadsheetIdFor();
  await ensureSheet(options.sheetName, spreadsheetId);
  const values = await readSheetValues(options.sheetName, spreadsheetId).catch(
    () => [] as any[][],
  );
  if (!values.length) {
    await overwriteSheetRows(
      options.sheetName,
      options.headers,
      [options.row],
      spreadsheetId,
    );
    return { action: "created" as const, rowNumber: 2 };
  }
  const currentHeaders = (values[0] || []).map((h: any) => norm(h));
  const effectiveHeaders = mergeHeaders(
    options.headers,
    currentHeaders.filter(Boolean),
  );
  const compactCurrentHeaders = currentHeaders.filter(Boolean);
  const needsHeaderRewrite =
    effectiveHeaders.join("\u0001") !== compactCurrentHeaders.join("\u0001");

  // If the existing private sheet uses older headers or a different column order,
  // rewrite the sheet as objects before changing a row. This avoids shifting old
  // data under the wrong headers when we add columns like id/active.
  if (needsHeaderRewrite) {
    const existingObjects = values
      .slice(1)
      .filter((row) => (row || []).some((cell: any) => norm(cell) !== ""))
      .map((row) => {
        const obj: SheetRow = {};
        currentHeaders.forEach((header, idx) => {
          if (header) obj[header] = row[idx] ?? "";
        });
        return obj;
      });
    const existingIndex = existingObjects.findIndex(
      (obj) => norm(obj[options.keyHeader]) === norm(options.keyValue),
    );
    if (existingIndex >= 0) {
      existingObjects[existingIndex] = { ...existingObjects[existingIndex], ...options.row };
      await overwriteSheetRows(options.sheetName, effectiveHeaders, existingObjects, spreadsheetId);
      return { action: "updated" as const, rowNumber: existingIndex + 2 };
    }
    existingObjects.push(options.row);
    await overwriteSheetRows(options.sheetName, effectiveHeaders, existingObjects, spreadsheetId);
    return { action: "created" as const, rowNumber: existingObjects.length + 1 };
  }

  const keyIdx = effectiveHeaders.indexOf(options.keyHeader);
  if (keyIdx < 0) throw new Error(`Missing key header ${options.keyHeader}`);
  const existingIndex = values.findIndex(
    (r, idx) => idx > 0 && norm(r[keyIdx]) === norm(options.keyValue),
  );
  if (existingIndex < 0) {
    await appendSheetRows(
      options.sheetName,
      effectiveHeaders,
      [options.row],
      spreadsheetId,
    );
    return { action: "created" as const, rowNumber: values.length + 1 };
  }
  const rowNumber = existingIndex + 1;
  const out = effectiveHeaders.map((header) => options.row[header] ?? "");
  await sheetsFetch(
    withValueInputOption(
      valuesPath(
        spreadsheetId,
        options.sheetName,
        `A${rowNumber}:${columnName(effectiveHeaders.length)}${rowNumber}`,
      ),
      "RAW",
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        range: `${quoteSheetName(options.sheetName)}!A${rowNumber}:${columnName(effectiveHeaders.length)}${rowNumber}`,
        majorDimension: "ROWS",
        values: [out],
      }),
    },
  );
  return { action: "updated" as const, rowNumber };
}

export async function loadRowsPrivateFirst(options: {
  kind: string;
  sheetName: string;
  csvUrls?: string[];
  spreadsheetId?: string;
}) {
  const spreadsheetId = options.spreadsheetId || spreadsheetIdFor(options.kind);
  let privateWarning = "";
  if (privateSheetsConfigured()) {
    try {
      const rows = await readSheetRows(options.sheetName, spreadsheetId);
      if (rows.length || !options.csvUrls?.some(Boolean)) {
        return {
          rows,
          source: "private-sheet",
          configured: true,
          privateConfigured: true,
          warning: "",
        };
      }
      privateWarning = `Private sheet "${options.sheetName}" is empty. Loaded legacy CSV fallback for viewing; saving will copy the rows into the private sheet.`;
    } catch (error: any) {
      privateWarning = friendlyGoogleAuthError(error);
      // Fall through to legacy CSV only when provided; returning an explicit warning helps admin pages.
      if (!options.csvUrls?.some(Boolean)) {
        return {
          rows: [] as SheetRow[],
          source: "private-sheet",
          configured: true,
          privateConfigured: true,
          warning: privateWarning || "private sheet unavailable",
        };
      }
    }
  }
  const csvUrl = (options.csvUrls || []).find((url) => norm(url));
  if (!csvUrl)
    return {
      rows: [] as SheetRow[],
      source: "",
      configured: false,
      privateConfigured: privateSheetsConfigured(),
      warning: privateWarning,
    };
  try {
    const Papa = await import("papaparse");
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok)
      return {
        rows: [] as SheetRow[],
        source: "legacy-csv",
        configured: true,
        privateConfigured: privateSheetsConfigured(),
        warning: privateWarning || `CSV unavailable (${res.status})`,
      };
    const text = await res.text();
    const parsed = Papa.default.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    }) as any;
    return {
      rows: parsed.data || [],
      source: "legacy-csv",
      configured: true,
      privateConfigured: privateSheetsConfigured(),
      warning: privateWarning
        ? `${privateWarning} Loaded legacy CSV fallback for viewing only.`
        : "",
    };
  } catch (error: any) {
    return {
      rows: [] as SheetRow[],
      source: "legacy-csv",
      configured: true,
      privateConfigured: privateSheetsConfigured(),
      warning: privateWarning || error?.message || "CSV unavailable",
    };
  }
}

export async function testPrivateSheetAccess() {
  if (!privateSheetsConfigured())
    return {
      ok: false,
      ...privateSheetsConfigSummary(),
      error: "Private Google Sheets is not configured.",
    };
  try {
    const spreadsheetId = spreadsheetIdFor();
    const meta = await getSpreadsheet(spreadsheetId);
    const sheetTitles = (meta.sheets || [])
      .map((s: any) => s?.properties?.title)
      .filter(Boolean);
    return { ok: true, ...privateSheetsConfigSummary(), sheetTitles };
  } catch (error: any) {
    return {
      ok: false,
      ...privateSheetsConfigSummary(),
      error: friendlyGoogleAuthError(error),
    };
  }
}
