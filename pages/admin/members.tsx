import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Papa from "papaparse";
import Header from "../../components/Header";
import BusyOverlay from "../../components/BusyOverlay";
import useAuthGuard from "../../hooks/useAuthGuard";

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  parentName: string;
  parentEmail: string;
  years: string;
  active: boolean;
};
type FormState = {
  id?: string;
  firstName: string;
  lastName: string;
  gender: string;
  parentName: string;
  parentEmail: string;
  years: string;
  active: boolean;
};

const emptyForm: FormState = {
  firstName: "",
  lastName: "",
  gender: "female",
  parentName: "",
  parentEmail: "",
  years: "",
  active: true,
};
const memberHeaders = [
  "id",
  "firstName",
  "lastName",
  "gender",
  "parentName",
  "parentEmail",
  "years",
  "active",
];
const yearOptions = [
  "Kindy",
  ...Array.from({ length: 12 }, (_, i) => `Year ${i + 1}`),
];

function fullName(m: Member) {
  return `${m.firstName} ${m.lastName}`.trim();
}
function cleanGender(v: any) {
  const g = String(v || "")
    .trim()
    .toLowerCase();
  if (g === "f" || g === "female") return "female";
  if (g === "m" || g === "male") return "male";
  return "female";
}
function displayGender(v: any) {
  return cleanGender(v) === "female" ? "Female" : "Male";
}
function toCsv(rows: Member[]) {
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    memberHeaders.join(","),
    ...rows.map((r) => memberHeaders.map((h) => esc((r as any)[h])).join(",")),
  ].join("\n");
}
function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function cleanHeader(header: string) {
  return String(header || "")
    .replace(/^\ufeff/, "")
    .trim();
}
function hasAnyValue(row: any) {
  return Object.values(row || {}).some(
    (value) => String(value ?? "").trim() !== "",
  );
}

function Alert({
  type,
  children,
}: {
  type: "error" | "success" | "warning";
  children: ReactNode;
}) {
  return <div className={`admin-alert ${type}`}>{children}</div>;
}

export default function AdminMembersPage() {
  useAuthGuard();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [source, setSource] = useState("");
  const [privateConfigured, setPrivateConfigured] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [viewing, setViewing] = useState<Member | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importError, setImportError] = useState("");

  function setMembersSorted(rows: Member[]) {
    setMembers(
      [...(rows || [])].sort((a, b) => fullName(a).localeCompare(fullName(b))),
    );
  }

  async function load() {
    setLoading(true);
    setError("");
    setMessage("");
    setWarning("");
    try {
      const res = await fetch("/api/admin-members", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok)
        throw new Error(json?.error || "Could not load members");
      setMembersSorted(Array.isArray(json.members) ? json.members : []);
      setSource(json.source || "");
      setPrivateConfigured(!!json.privateSheetsConfigured);
      setWarning(json.warning || "");
    } catch (e: any) {
      setError(e?.message || "Could not load members");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => (tab === "active" ? m.active : !m.active))
      .filter(
        (m) =>
          !q ||
          [fullName(m), m.parentName, m.parentEmail, m.years, m.gender, m.id]
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }, [members, query, tab]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
    setMessage("");
    setError("");
  }
  function openEdit(m: Member) {
    setEditing(m);
    setForm({ ...m, gender: cleanGender(m.gender) });
    setFormOpen(true);
    setMessage("");
    setError("");
  }

  async function post(body: any) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const detail =
          Array.isArray(json?.errors) && json.errors.length
            ? ` ${json.errors.slice(0, 5).join(" ")}`
            : "";
        throw new Error((json?.error || "Save failed") + detail);
      }
      if (Array.isArray(json.members)) setMembersSorted(json.members);
      else await load();
      setSource(json.source || "private-sheet");
      setWarning("");
      return json;
    } catch (e: any) {
      setError(e?.message || "Save failed");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post(
        editing
          ? { action: "update", id: editing.id, member: form }
          : { action: "create", member: form },
      );
      setFormOpen(false);
      setEditing(null);
      setMessage(editing ? "Member updated." : "Member added.");
    } catch {}
  }

  async function changeActive(m: Member, active: boolean) {
    if (
      !window.confirm(`${active ? "Reactivate" : "Deactivate"} ${fullName(m)}?`)
    )
      return;
    try {
      await post({ action: active ? "reactivate" : "deactivate", id: m.id });
      setMessage(active ? "Member reactivated." : "Member moved to inactive.");
    } catch {}
  }

  async function checkSheets() {
    setError("");
    setMessage("Checking private Google Sheets connection…");
    try {
      const res = await fetch("/api/admin-sheets-status", {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok)
        throw new Error(json?.error || "Could not check connection");
      setMessage(
        `Private Sheets OK. Service account: ${json.email || "configured"}. Tabs found: ${(json.sheetTitles || []).join(", ") || "none"}.`,
      );
    } catch (e: any) {
      setMessage("");
      setError(e?.message || "Private Google Sheets connection failed");
    }
  }

  function handleImportFile(file?: File | null) {
    setImportRows([]);
    setImportError("");
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: cleanHeader,
      complete: (result) => {
        const parseErrors =
          result.errors?.map((err) => err.message).filter(Boolean) || [];
        const rows = ((result.data || []) as any[]).filter(hasAnyValue);
        setImportRows(rows);
        if (!rows.length)
          setImportError(
            "No rows found in the file. Make sure it is saved as CSV, not XLSX.",
          );
        else if (parseErrors.length)
          setImportError(`CSV parsed with warning: ${parseErrors[0]}`);
      },
      error: (err) => setImportError(err.message),
    });
  }

  async function submitImport() {
    if (!importRows.length) {
      setImportError("Choose a CSV file first.");
      return;
    }
    try {
      const json = await post({ action: "import", rows: importRows });
      setImportOpen(false);
      setImportRows([]);
      setImportError("");
      setMessage(
        `Import complete. Created ${json.created || 0}, updated ${json.updated || 0}.`,
      );
    } catch {}
  }

  const activeCount = members.filter((m) => m.active).length;
  const inactiveCount = members.filter((m) => !m.active).length;
  const sourceLabel =
    source === "private-sheet"
      ? "Private Google Sheet"
      : source
        ? "Legacy CSV fallback"
        : "Unknown source";
  const previewRows = importRows.slice(0, 5);

  return (
    <div>
      <Header />
      <BusyOverlay
        open={saving}
        title="Saving changes…"
        subtitle="Updating the private Google Sheet. This usually takes a few seconds."
      />
      <main className="container admin-page">
        <section className="card management-hero">
          <div className="management-hero-top">
            <div>
              <div className="eyebrow">Admin tools</div>
              <h2 className="section-title">Members</h2>
              <p className="text-muted">
                Manage student contacts from the portal. Google Sheets stays
                private in the background.
              </p>
            </div>
            <div className="management-actions">
              <Link className="btn" href="/admin" prefetch={false}>← Admin</Link>
              <button
                className="btn"
                onClick={checkSheets}
                disabled={loading || saving}
              >
                Check Sheets
              </button>
              <button
                className="btn"
                onClick={() =>
                  download("success-tutoring-members.csv", toCsv(members))
                }
              >
                Export CSV
              </button>
              <button
                className="btn"
                onClick={() => {
                  setImportOpen(true);
                  setImportError("");
                  setImportRows([]);
                }}
              >
                Import CSV
              </button>
              <button className="btn-primary" onClick={openAdd}>
                Add Member
              </button>
            </div>
          </div>

          <div className="admin-status-grid mt-4">
            <div className="status-card">
              <span>Active students</span>
              <strong>{activeCount}</strong>
            </div>
            <div className="status-card">
              <span>Inactive students</span>
              <strong>{inactiveCount}</strong>
            </div>
            <div className="status-card wide">
              <span>Data source</span>
              <strong>{sourceLabel}</strong>
              <small>
                {privateConfigured
                  ? "Private Sheets configured"
                  : "Private Sheets not configured"}
              </small>
            </div>
          </div>

          {warning && <Alert type="warning">{warning}</Alert>}
          {error && <Alert type="error">{error}</Alert>}
          {message && <Alert type="success">{message}</Alert>}

          <div className="management-toolbar mt-4">
            <div className="segmented">
              <button
                className={`seg-btn ${tab === "active" ? "active" : ""}`}
                onClick={() => setTab("active")}
              >
                Active ({activeCount})
              </button>
              <button
                className={`seg-btn ${tab === "inactive" ? "active" : ""}`}
                onClick={() => setTab("inactive")}
              >
                Inactive ({inactiveCount})
              </button>
            </div>
            <input
              className="input management-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search student, parent, email, year..."
            />
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <section className="admin-table-shell mt-4">
            <div className="admin-table-head members-grid">
              <span>Student</span>
              <span>Year</span>
              <span>Gender</span>
              <span>Parent</span>
              <span>Email</span>
              <span>Actions</span>
            </div>
            {loading ? (
              <div className="empty-state">Loading members…</div>
            ) : filtered.length ? (
              filtered.map((m) => (
                <div className="admin-table-row members-grid" key={m.id}>
                  <div className="member-cell">
                    <div className="avatar-dot">
                      {(m.firstName || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <strong>{fullName(m)}</strong>
                      <div className="text-sm text-muted">{m.id}</div>
                    </div>
                  </div>
                  <div>{m.years || "—"}</div>
                  <div>
                    <span className="soft-pill">{displayGender(m.gender)}</span>
                  </div>
                  <div>{m.parentName || "—"}</div>
                  <div className="text-sm email-cell">
                    {m.parentEmail || "—"}
                  </div>
                  <div className="row-actions">
                    <button className="btn" onClick={() => setViewing(m)}>
                      View
                    </button>
                    <button className="btn" onClick={() => openEdit(m)}>
                      Edit
                    </button>
                    {m.active ? (
                      <button
                        className="btn"
                        onClick={() => changeActive(m, false)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="btn"
                        onClick={() => changeActive(m, true)}
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">No {tab} members found.</div>
            )}
          </section>
        </section>
      </main>

      <datalist id="school-year-options">
        {yearOptions.map((year) => (
          <option key={year} value={year} />
        ))}
      </datalist>

      {formOpen && (
        <div
          className="modal-backdrop"
          onClick={() => !saving && setFormOpen(false)}
        >
          <form
            className="card modal-card admin-modal-card"
            onSubmit={saveForm}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title-row">
              <div>
                <h3 className="section-title" style={{ fontSize: "1.25rem" }}>
                  {editing ? "Edit Member" : "Add Member"}
                </h3>
                {editing && (
                  <div className="text-sm text-muted">
                    Permanent ID: {editing.id}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Close
              </button>
            </div>
            <div className="grid grid-2 grid-col mt-4">
              <label>
                <span className="label">Student first name</span>
                <input
                  className="input"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span className="label">Student last name</span>
                <input
                  className="input"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span className="label">Gender</span>
                <select
                  className="input"
                  value={cleanGender(form.gender)}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                  required
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </label>
              <label>
                <span className="label">School year</span>
                <input
                  className="input"
                  list="school-year-options"
                  value={form.years}
                  onChange={(e) => setForm({ ...form, years: e.target.value })}
                  placeholder="Year 3"
                  required
                />
              </label>
              <label>
                <span className="label">Parent first name</span>
                <input
                  className="input"
                  value={form.parentName}
                  onChange={(e) =>
                    setForm({ ...form, parentName: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span className="label">Parent email</span>
                <input
                  className="input"
                  type="email"
                  value={form.parentEmail}
                  onChange={(e) =>
                    setForm({ ...form, parentEmail: e.target.value })
                  }
                  required
                />
              </label>
            </div>
            {editing && (
              <label className="mt-4 flex gap-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />{" "}
                Active
              </label>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      {viewing && (
        <div className="modal-backdrop" onClick={() => setViewing(null)}>
          <div
            className="card modal-card admin-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title-row">
              <div>
                <h3 className="section-title" style={{ fontSize: "1.25rem" }}>
                  {fullName(viewing)}
                </h3>
                <div className="text-sm text-muted">
                  {viewing.active ? "Active member" : "Inactive member"}
                </div>
              </div>
              <button className="btn" onClick={() => setViewing(null)}>
                Close
              </button>
            </div>
            <div className="profile-list-row">
              <strong>ID</strong>
              <div className="text-muted">{viewing.id}</div>
            </div>
            <div className="profile-list-row">
              <strong>Year</strong>
              <div className="text-muted">{viewing.years}</div>
            </div>
            <div className="profile-list-row">
              <strong>Gender</strong>
              <div className="text-muted">{displayGender(viewing.gender)}</div>
            </div>
            <div className="profile-list-row">
              <strong>Parent first name</strong>
              <div className="text-muted">{viewing.parentName}</div>
            </div>
            <div className="profile-list-row">
              <strong>Parent email</strong>
              <div className="text-muted">{viewing.parentEmail}</div>
            </div>
            <div className="profile-list-row">
              <strong>Status</strong>
              <div className="text-muted">
                {viewing.active ? "Active" : "Inactive"}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setViewing(null)}>
                Close
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  setViewing(null);
                  openEdit(viewing);
                }}
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div
          className="modal-backdrop"
          onClick={() => !saving && setImportOpen(false)}
        >
          <div
            className="card modal-card admin-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title-row">
              <div>
                <h3 className="section-title" style={{ fontSize: "1.25rem" }}>
                  Import Members CSV
                </h3>
                <p className="text-muted">
                  Save your Excel file as CSV, then upload it here. Existing
                  rows are updated by ID, or by matching student name + parent
                  email.
                </p>
              </div>
              <button
                className="btn"
                onClick={() => setImportOpen(false)}
                disabled={saving}
              >
                Close
              </button>
            </div>
            <div className="import-help-grid mt-4">
              <div className="import-help-card">
                <strong>Required headers</strong>
                <code>
                  id, firstName, lastName, gender, parentName, parentEmail,
                  years, active
                </code>
              </div>
              <div className="import-help-card">
                <strong>Allowed gender values</strong>
                <span>Female, Male, F, M</span>
              </div>
              <div className="import-help-card">
                <strong>New student IDs</strong>
                <span>
                  Leave ID blank and the portal will create a permanent mem_ ID.
                </span>
              </div>
            </div>
            <pre className="import-format mt-4">
              id,firstName,lastName,gender,parentName,parentEmail,years,active
              {"\n"}mem_abc123,Alex,Example,female,Jamie,parent@example.com,Year 6,TRUE
            </pre>
            <div className="flex gap-2 mt-4" style={{ flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() =>
                  download(
                    "members-import-template.csv",
                    `id,firstName,lastName,gender,parentName,parentEmail,years,active\n,Sam,Example,female,Alex,parent@example.com,Year 5,TRUE\n`,
                  )
                }
              >
                Download template
              </button>
              <input
                className="input"
                style={{ maxWidth: 420 }}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleImportFile(e.target.files?.[0])}
              />
            </div>
            {importError && <Alert type="error">{importError}</Alert>}
            {!!importRows.length && (
              <Alert type="success">
                Ready to import {importRows.length} row
                {importRows.length === 1 ? "" : "s"}.
              </Alert>
            )}
            {!!previewRows.length && (
              <div className="import-preview">
                <div className="text-sm text-muted mb-2">
                  Preview first {previewRows.length} row
                  {previewRows.length === 1 ? "" : "s"}
                </div>
                {previewRows.map((row, idx) => (
                  <div className="import-preview-row" key={idx}>
                    {Object.entries(row)
                      .slice(0, 8)
                      .map(([key, value]) => (
                        <span key={key}>
                          <strong>{key}:</strong> {String(value || "—")}
                        </span>
                      ))}
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => setImportOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={submitImport}
                disabled={saving || !importRows.length}
              >
                {saving ? "Importing…" : "Import CSV"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
