import crypto from "crypto";
import {
  appendSheetRows,
  loadRowsPrivateFirst,
  overwriteSheetRows,
  privateSheetsConfigured,
  sheetNames,
  spreadsheetIdFor,
  upsertSheetRowByKey,
} from "./googleSheets";

export type Member = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  parentName: string;
  parentEmail: string;
  years: string;
  active: boolean;
};

export const MEMBER_HEADERS = [
  "id",
  "firstName",
  "lastName",
  "gender",
  "parentName",
  "parentEmail",
  "years",
  "active",
];

function norm(value: any) {
  return String(value ?? "").trim();
}
function lower(value: any) {
  return norm(value).toLowerCase();
}
function keyName(value: any) {
  return lower(value)
    .replace(/^\ufeff/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function truthyActive(value: any) {
  const s = lower(value);
  if (!s) return true;
  return ["true", "yes", "y", "1", "active", "enabled"].includes(s);
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

export function normalizeGender(value: any) {
  const g = lower(value);
  if (["f", "female", "girl"].includes(g)) return "female";
  if (["m", "male", "boy"].includes(g)) return "male";
  return "";
}

export function displayGender(value: any) {
  const g = normalizeGender(value);
  if (g === "female") return "Female";
  if (g === "male") return "Male";
  return norm(value) || "—";
}

export function generateMemberId() {
  return `mem_${crypto.randomBytes(5).toString("hex")}`;
}

export function normalizeMemberRow(row: any): Member | null {
  const firstName = readValue(
    row,
    "firstName",
    "FirstName",
    "First Name",
    "first",
    "First",
  );
  const lastName = readValue(
    row,
    "lastName",
    "LastName",
    "Last Name",
    "last",
    "Last",
  );
  const fullName = readValue(
    row,
    "Name",
    "name",
    "student",
    "Student",
    "studentName",
    "StudentName",
  );
  const parts =
    fullName && !firstName ? fullName.split(/\s+/).filter(Boolean) : [];
  const first = firstName || parts[0] || "";
  const last = lastName || parts.slice(1).join(" ");
  if (!first && !last) return null;
  return {
    id:
      readValue(row, "id", "ID", "memberId", "MemberID", "Member ID") ||
      generateMemberId(),
    firstName: first,
    lastName: last,
    gender: normalizeGender(readValue(row, "gender", "Gender", "Sex")),
    parentName: readValue(
      row,
      "parentName",
      "ParentName",
      "Parent Name",
      "parentFirstName",
      "ParentFirstName",
      "Parent First Name",
    ),
    parentEmail: readValue(
      row,
      "parentEmail",
      "ParentEmail",
      "Parent Email",
      "Email",
      "email",
    ).toLowerCase(),
    years: readValue(
      row,
      "years",
      "Years",
      "School Year",
      "schoolYear",
      "year",
      "Year",
    ),
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
  };
}

export async function loadMembers() {
  const result = await loadRowsPrivateFirst({
    kind: "CONTACTS",
    sheetName: sheetNames.contacts(),
    csvUrls: [
      process.env.CONTACTS_CSV_URL || "",
      process.env.NEXT_PUBLIC_CONTACTS_CSV_URL || "",
    ],
  });
  const members = (result.rows || [])
    .map(normalizeMemberRow)
    .filter(Boolean) as Member[];
  members.sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(
      `${b.firstName} ${b.lastName}`,
    ),
  );
  return { ...result, members };
}

export function memberToSheetRow(member: Member) {
  return {
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    gender: normalizeGender(member.gender),
    parentName: member.parentName,
    parentEmail: member.parentEmail.toLowerCase(),
    years: member.years,
    active: member.active ? "TRUE" : "FALSE",
  };
}

function requirePrivateSheetsForSave() {
  if (!privateSheetsConfigured())
    throw new Error(
      "Private Google Sheets is required to save members. Configure the service account first. Viewing from old CSV fallback is read-only.",
    );
}

export async function saveMembers(members: Member[]) {
  requirePrivateSheetsForSave();
  const rows = members.map(memberToSheetRow);
  await overwriteSheetRows(
    sheetNames.contacts(),
    MEMBER_HEADERS,
    rows,
    spreadsheetIdFor("CONTACTS"),
  );
}

export async function appendMember(member: Member) {
  requirePrivateSheetsForSave();
  await appendSheetRows(
    sheetNames.contacts(),
    MEMBER_HEADERS,
    [memberToSheetRow(member)],
    spreadsheetIdFor("CONTACTS"),
  );
}

export async function saveMemberRow(member: Member) {
  requirePrivateSheetsForSave();
  await upsertSheetRowByKey({
    sheetName: sheetNames.contacts(),
    headers: MEMBER_HEADERS,
    keyHeader: "id",
    keyValue: member.id,
    row: memberToSheetRow(member),
    spreadsheetId: spreadsheetIdFor("CONTACTS"),
  });
}

export function cleanMemberInput(input: any, existingId?: string): Member {
  const fullName = readValue(
    input,
    "Name",
    "name",
    "student",
    "Student",
    "studentName",
    "StudentName",
    "Student Name",
  );
  const parts = fullName.split(/\s+/).filter(Boolean);
  const id =
    existingId ||
    readValue(input, "id", "ID", "memberId", "MemberID", "Member ID") ||
    generateMemberId();
  const firstName =
    readValue(
      input,
      "firstName",
      "FirstName",
      "First Name",
      "first",
      "First",
    ) ||
    parts[0] ||
    "";
  const lastName =
    readValue(input, "lastName", "LastName", "Last Name", "last", "Last") ||
    parts.slice(1).join(" ");
  const gender = normalizeGender(readValue(input, "gender", "Gender", "Sex"));
  const parentName = readValue(
    input,
    "parentName",
    "ParentName",
    "Parent Name",
    "parentFirstName",
    "ParentFirstName",
    "Parent First Name",
  );
  const parentEmail = readValue(
    input,
    "parentEmail",
    "ParentEmail",
    "Parent Email",
    "Email",
    "email",
  ).toLowerCase();
  const years = readValue(
    input,
    "years",
    "Years",
    "School Year",
    "schoolYear",
    "year",
    "Year",
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
      ? true
      : truthyActive(activeRaw || input?.active);
  if (!firstName) throw new Error("Student first name is required");
  if (!lastName) throw new Error("Student last name is required");
  if (!gender)
    throw new Error(
      "Gender must be male or female. M/F is also accepted on imports.",
    );
  if (!parentName) throw new Error("Parent first name is required");
  if (!parentEmail) throw new Error("Parent email is required");
  if (!years) throw new Error("School year is required");
  return {
    id,
    firstName,
    lastName,
    gender,
    parentName,
    parentEmail,
    years,
    active,
  };
}

export function findDuplicateMember(
  members: Member[],
  candidate: Member,
  ignoreId?: string,
) {
  const name = `${candidate.firstName} ${candidate.lastName}`
    .trim()
    .toLowerCase();
  const email = candidate.parentEmail.toLowerCase();
  return members.find((member) => {
    if (ignoreId && member.id === ignoreId) return false;
    const memberName = `${member.firstName} ${member.lastName}`
      .trim()
      .toLowerCase();
    return memberName === name && member.parentEmail.toLowerCase() === email;
  });
}
