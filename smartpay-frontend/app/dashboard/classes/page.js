"use client";

import { useEffect, useState } from "react";
import { Plus, School, Search, MoreHorizontal } from "lucide-react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingSkeleton,
  Modal,
  MobileRecordCard,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";
import { Badge2, Button2, Card2 } from "@/components/ui2";

// The schema only stores a numeric sort-order `level`, not a text grouping —
// "Grade Level" (Basic vs Junior High) is derived here from the class's own
// name, following the naming convention already used for every seeded class
// (Basic 1-6, JHS 1-3). Not a stored field, so it's inferred, not invented.
function gradeLevelLabel(name) {
  const n = name.trim().toLowerCase();
  if (n.startsWith("jhs") || n.startsWith("junior")) return "Junior High";
  if (n.startsWith("basic")) return "Basic";
  return "—";
}

function AddClassModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", level: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/classes", { method: "POST", body: { name: form.name, level: form.level ? Number(form.level) : undefined } });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Class" description="e.g. Basic 1, Basic 2, JHS 1." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Class Name"><input required placeholder="e.g. Basic 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} /></Field>
        <Field label="Level (optional, for sort order)"><input type="number" placeholder="e.g. 1" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} className={inputClass} /></Field>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button2 variant="secondary" type="button" onClick={onClose}>Cancel</Button2>
          <Button2 type="submit" disabled={saving}>{saving ? "Adding..." : "Add Class"}</Button2>
        </div>
      </form>
    </Modal>
  );
}

function RowActions({ cls, onToggleStatus }) {
  const [open, setOpen] = useState(false);
  const archived = cls.status === "archived";
  return (
    <div className="relative inline-block text-left">
      <button onClick={() => setOpen((o) => !o)} aria-label="Row actions" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--slate-quiet)] hover:bg-[var(--hover)]">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--shadow-soft)]">
            <button
              onClick={() => { setOpen(false); onToggleStatus(cls, archived ? "active" : "archived"); }}
              className="flex min-h-[40px] w-full items-center px-3 text-left text-sm text-[var(--slate)] hover:bg-[var(--hover)]"
            >
              {archived ? "Reactivate" : "Archive"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ClassesPage() {
  const [classes, setClasses] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/classes?status=all")
      .then((res) => setClasses(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function toggleStatus(cls, status) {
    try {
      await apiRequest(`/classes/${cls.id}/status`, { method: "PATCH", body: { status } });
      load();
      showToast(status === "active" ? "Class reactivated." : "Class archived.");
    } catch (err) {
      showToast(err.message, "danger");
    }
  }

  const filtered = (classes || []).filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.name.toLowerCase().includes(q);
    const matchesGrade = !gradeFilter || gradeLevelLabel(c.name) === gradeFilter;
    const matchesStatus = !statusFilter || c.status === statusFilter;
    return matchesSearch && matchesGrade && matchesStatus;
  });

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Classes</h1>
          <p className="mt-1 text-sm text-[var(--slate-quiet)]">Manage your school classes and their details.</p>
        </div>
        <Button2 onClick={() => setShowAddModal(true)}><Plus size={16} /> Add Class</Button2>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}

      <Card2 className="mt-6 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--slate-quiet)]" />
          <input
            type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search classes..."
            className="w-full rounded-lg border border-[var(--border)] py-2.5 pl-9 pr-3 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All Grades</option>
          <option value="Basic">Basic</option>
          <option value="Junior High">Junior High</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </Card2>

      {!classes && !loadError && <div className="mt-4"><LoadingSkeleton lines={4} /></div>}

      {classes && (
        <>
          <div className="mt-4 space-y-3 md:hidden">
            {filtered.length === 0 && <EmptyState>No classes match these filters.</EmptyState>}
            {filtered.map((c) => (
              <MobileRecordCard key={c.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--primary-wash)] text-[var(--primary)]"><School size={16} /></div>
                    <div>
                      <p className="font-medium text-[var(--ink)]">{c.name}</p>
                      <p className="text-xs text-[var(--slate-quiet)]">{gradeLevelLabel(c.name)} · {c.student_count} student{c.student_count === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <Badge2 tone={c.status === "active" ? "success" : "neutral"}>{c.status === "active" ? "Active" : "Archived"}</Badge2>
                </div>
                <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-3">
                  <RowActions cls={c} onToggleStatus={toggleStatus} />
                </div>
              </MobileRecordCard>
            ))}
          </div>

          <Card2 className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Class Name</th><th className="p-3 font-medium">Grade Level</th>
                  <th className="p-3 font-medium">Students</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--primary-wash)] text-[var(--primary)]"><School size={14} /></div>
                        <span className="font-medium text-[var(--ink)]">{c.name}</span>
                      </div>
                    </td>
                    <td className="p-3">{gradeLevelLabel(c.name)}</td>
                    <td className="p-3">{c.student_count}</td>
                    <td className="p-3"><Badge2 tone={c.status === "active" ? "success" : "neutral"}>{c.status === "active" ? "Active" : "Archived"}</Badge2></td>
                    <td className="p-3 text-right"><RowActions cls={c} onToggleStatus={toggleStatus} /></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No classes match these filters.</td></tr>}
              </tbody>
            </table>
          </Card2>
          <p className="mt-3 text-xs text-[var(--slate-quiet)]">Showing {filtered.length} of {classes.length} classes</p>
        </>
      )}

      {showAddModal && <AddClassModal onClose={() => setShowAddModal(false)} onCreated={() => { load(); showToast("Class added."); }} />}
      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
