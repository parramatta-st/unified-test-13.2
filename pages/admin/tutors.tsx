import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Papa from "papaparse";
import Header from "../../components/Header";
import BusyOverlay from "../../components/BusyOverlay";
import useAuthGuard from "../../hooks/useAuthGuard";

type Tutor = {
  campusKey: string;
  campusName: string;
  tutorName: string;
  role: "admin" | "tutor";
  active: boolean;
  email: string;
};
type FormState = Tutor;
function defaultCampusFromEnv() {
  try {
    const parsed = JSON.parse(process.env.NEXT_PUBLIC_CAMPUSES_JSON || "[]");
    const campuses = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const first = campuses[0] || {};
    const id = String(first.id || first.campusKey || "parramatta").trim().toLowerCase();
    const name = String(first.name || first.campusName || id || "Parramatta").trim();
    return { id: id || "parramatta", name: name || id || "Parramatta" };
  } catch {
    return { id: "parramatta", name: "Parramatta" };
  }
}
function blankTutorForm(): FormState {
  const campus = defaultCampusFromEnv();
  return {
    campusKey: campus.id,
    campusName: campus.name,
    tutorName: "",
    role: "tutor",
    active: true,
    email: "",
  };
}
const tutorHeaders = [
  "campusKey",
  "tutorName",
  "role",
  "active",
  "email",
  "campusName",
];

function keyOf(t: Tutor) {
  return `${t.campusKey}|${t.tutorName}`;
}
function toCsv(rows: Tutor[]) {
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    tutorHeaders.join(","),
    ...rows.map((r) => tutorHeaders.map((h) => esc((r as any)[h])).join(",")),
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

export default function AdminTutorsPage() {
  useAuthGuard();
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [privateConfigured, setPrivateConfigured] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Tutor | null>(null);
  const [form, setForm] = useState<FormState>(blankTutorForm());
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importError, setImportError] = useState("");

  function setTutorsSorted(rows: Tutor[]) {
    setTutors(
      [...(rows || [])].sort((a, b) => a.tutorName.localeCompare(b.tutorName)),
    );
  }

  async function load() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin-tutors", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok)
        throw new Error(json?.error || "Could not load tutors");
      setTutorsSorted(Array.isArray(json.tutors) ? json.tutors : []);
      setPrivateConfigured(!!json.privateSheetsConfigured);
    } catch (e: any) {
      setError(e?.message || "Could not load tutors");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tutors
      .filter((t) => (tab === "active" ? t.active : !t.active))
      .filter(
        (t) =>
          !q ||
          [t.tutorName, t.role, t.campusKey, t.campusName, t.email]
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => a.tutorName.localeCompare(b.tutorName));
  }, [tutors, query, tab]);

  function openAdd() {
    setEditing(null);
    setForm(blankTutorForm());
    setFormOpen(true);
    setError("");
    setMessage("");
  }
  function openEdit(t: Tutor) {
    setEditing(t);
    setForm({ ...t });
    setFormOpen(true);
    setError("");
    setMessage("");
  }

  async function post(body: any) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin-tutors", {
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
      if (Array.isArray(json.tutors)) setTutorsSorted(json.tutors);
      else await load();
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
          ? {
              action: "update",
              originalCampusKey: editing.campusKey,
              originalTutorName: editing.tutorName,
              tutor: form,
            }
          : { action: "create", tutor: form },
      );
      setFormOpen(false);
      setEditing(null);
      setMessage(editing ? "Tutor updated." : "Tutor added.");
    } catch {}
  }

  async function changeActive(t: Tutor, active: boolean) {
    if (
      !window.confirm(`${active ? "Reactivate" : "Deactivate"} ${t.tutorName}?`)
    )
      return;
    try {
      await post({
        action: active ? "reactivate" : "deactivate",
        campusKey: t.campusKey,
        tutorName: t.tutorName,
      });
      setMessage(active ? "Tutor reactivated." : "Tutor moved to inactive.");
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

  const activeCount = tutors.filter((t) => t.active).length;
  const inactiveCount = tutors.filter((t) => !t.active).length;
  const adminCount = tutors.filter(
    (t) => t.active && t.role === "admin",
  ).length;
  const previewRows = importRows.slice(0, 5);

  return (
    <div>
      <Header />
      <BusyOverlay
        open={saving}
        title="Saving tutor changes…"
        subtitle="Updating the private tutor sheet."
      />
      <main className="container admin-page">
        <section className="card management-hero">
          <div className="management-hero-top">
            <div>
              <div className="eyebrow">Admin tools</div>
              <h2 className="section-title">Tutors</h2>
              <p className="text-muted">
                Manage tutor login names and admin roles from the portal.
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
                  download("success-tutoring-tutors.csv", toCsv(tutors))
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
                Add Tutor
              </button>
            </div>
          </div>
          <div className="admin-status-grid mt-4">
            <div className="status-card">
              <span>Active tutors</span>
              <strong>{activeCount}</strong>
            </div>
            <div className="status-card">
              <span>Admins</span>
              <strong>{adminCount}</strong>
            </div>
            <div className="status-card">
              <span>Inactive</span>
              <strong>{inactiveCount}</strong>
            </div>
            <div className="status-card wide">
              <span>Private Sheets</span>
              <strong>{privateConfigured ? "Configured" : "Fallback"}</strong>
              <small>
                {privateConfigured
                  ? "Saving enabled"
                  : "Configure service account to save changes"}
              </small>
            </div>
          </div>

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
              placeholder="Search tutor, role, campus..."
            />
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <section className="admin-table-shell mt-4">
            <div className="admin-table-head tutors-grid">
              <span>Tutor</span>
              <span>Role</span>
              <span>Campus</span>
              <span>Email</span>
              <span>Actions</span>
            </div>
            {loading ? (
              <div className="empty-state">Loading tutors…</div>
            ) : filtered.length ? (
              filtered.map((t) => (
                <div className="admin-table-row tutors-grid" key={keyOf(t)}>
                  <div className="member-cell">
                    <div className="avatar-dot tutor">
                      {(t.tutorName || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <strong>{t.tutorName}</strong>
                      <div className="text-sm text-muted">
                        {t.active ? "Active" : "Inactive"}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span
                      className={`soft-pill ${t.role === "admin" ? "admin-role" : ""}`}
                    >
                      {t.role}
                    </span>
                  </div>
                  <div>
                    {t.campusName || t.campusKey}
                    <div className="text-sm text-muted">{t.campusKey}</div>
                  </div>
                  <div className="text-sm email-cell">{t.email || "—"}</div>
                  <div className="row-actions">
                    <button className="btn" onClick={() => openEdit(t)}>
                      Edit
                    </button>
                    {t.active ? (
                      <button
                        className="btn"
                        onClick={() => changeActive(t, false)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        className="btn"
                        onClick={() => changeActive(t, true)}
                      >
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">No {tab} tutors found.</div>
            )}
          </section>
        </section>
      </main>

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
                  {editing ? "Edit Tutor" : "Add Tutor"}
                </h3>
                <p className="text-muted">
                  Tutors use the shared site password, but their names and roles
                  come from this list.
                </p>
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
                <span className="label">Tutor name</span>
                <input
                  className="input"
                  value={form.tutorName}
                  onChange={(e) =>
                    setForm({ ...form, tutorName: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span className="label">Role</span>
                <select
                  className="input"
                  value={form.role}
                  onChange={(e) =>
                    setForm({ ...form, role: e.target.value as any })
                  }
                >
                  <option value="tutor">Tutor</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label>
                <span className="label">Campus key</span>
                <input
                  className="input"
                  value={form.campusKey}
                  onChange={(e) =>
                    setForm({ ...form, campusKey: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span className="label">Campus name</span>
                <input
                  className="input"
                  value={form.campusName}
                  onChange={(e) =>
                    setForm({ ...form, campusName: e.target.value })
                  }
                />
              </label>
              <label>
                <span className="label">Email optional</span>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <label
                className="flex gap-2"
                style={{ alignItems: "center", marginTop: 28 }}
              >
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm({ ...form, active: e.target.checked })
                  }
                />{" "}
                Active
              </label>
            </div>
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
                  Import Tutors CSV
                </h3>
                <p className="text-muted">
                  Save your Excel file as CSV. Existing tutors are updated by
                  matching campus key + tutor name.
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
                  campusKey, tutorName, role, active, email, campusName
                </code>
              </div>
              <div className="import-help-card">
                <strong>Roles</strong>
                <span>tutor or admin</span>
              </div>
              <div className="import-help-card">
                <strong>Active</strong>
                <span>TRUE for current tutors, FALSE for inactive tutors.</span>
              </div>
            </div>
            <pre className="import-format mt-4">
              campusKey,tutorName,role,active,email,campusName{"\n"}
              {defaultCampusFromEnv().id},Kevin,admin,TRUE,kevin@example.com,{defaultCampusFromEnv().name}
            </pre>
            <div className="flex gap-2 mt-4" style={{ flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() =>
                  download(
                    "tutors-import-template.csv",
                    `campusKey,tutorName,role,active,email,campusName\n${defaultCampusFromEnv().id},Kevin,admin,TRUE,kevin@example.com,${defaultCampusFromEnv().name}\n`,
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
