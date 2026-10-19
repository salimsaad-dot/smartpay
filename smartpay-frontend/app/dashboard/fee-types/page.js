"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingSkeleton,
  MobileRecordCard,
  Modal,
  PageHeader,
  StatusBadge,
  Toast,
  inputClass,
  useToast,
  RowMenu,
} from "@/components/ui";

const APPLICABILITY_LABELS = { class_wide: "All students in class", selected_students: "Selected students only" };
const FREQUENCY_LABELS = { weekly: "Weekly", termly: "Termly", annual: "Annual", one_time: "One-time", as_needed: "As needed" };

function AddFeeTypeForm({ onCreated }) {
  const [name, setName] = useState("");
  const [applicability, setApplicability] = useState("class_wide");
  const [frequency, setFrequency] = useState("termly");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/fee-types", { method: "POST", body: { name, applicability, frequency } });
      setName("");
      setApplicability("class_wide");
      setFrequency("termly");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <Field label="New Fee Type" className="w-full sm:min-w-[220px] sm:w-auto">
        <input required placeholder="e.g. Sports Levy" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Applies To" className="w-full sm:w-auto">
        <select value={applicability} onChange={(e) => setApplicability(e.target.value)} className={inputClass}>
          <option value="class_wide">All students in class</option>
          <option value="selected_students">Selected students only</option>
        </select>
      </Field>
      <Field label="Frequency" className="w-full sm:w-auto">
        <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClass}>
          {Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Button type="submit" disabled={saving}>{saving ? "Adding..." : "Add Fee Type"}</Button>
      {error && <p className="w-full text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

function EligibilityModal({ feeType, onClose, onSaved }) {
  const [students, setStudents] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest(`/fee-types/${feeType.id}/eligibility`)
      .then((res) => {
        setStudents(res.data);
        setSelected(new Set(res.data.filter((s) => s.eligible).map((s) => s.id)));
      })
      .catch((err) => setLoadError(err.message));
  }, [feeType.id]);

  function toggle(studentId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      await apiRequest(`/fee-types/${feeType.id}/eligibility`, { method: "PUT", body: { studentIds: Array.from(selected) } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const filtered = (students || []).filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) || s.class_name.toLowerCase().includes(q);
  });

  return (
    <Modal title={`Eligible Students — ${feeType.name}`} description="Only checked students will be billed when invoices are generated for this fee type. This list persists across terms — set it once." onClose={onClose}>
      {loadError && <ErrorState message={loadError} />}
      {!students && !loadError && <LoadingSkeleton lines={4} />}
      {students && (
        <div className="space-y-3">
          <input
            type="search" placeholder="Search students or class..." value={search} onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-[var(--slate-quiet)]">{selected.size} of {students.length} selected</p>
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
            {filtered.length === 0 && <p className="p-3 text-center text-sm text-[var(--slate-quiet)]">No students match.</p>}
            {filtered.map((s) => (
              <label key={s.id} className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-[var(--hover)]">
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4" />
                <span className="text-sm text-[var(--ink)]">{s.first_name} {s.last_name}</span>
                <span className="ml-auto text-xs text-[var(--slate-quiet)]">{s.class_name}</span>
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function RenameModal({ feeType, onClose, onRenamed }) {
  const [name, setName] = useState(feeType.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest(`/fee-types/${feeType.id}/name`, { method: "PATCH", body: { name } });
      onRenamed();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Rename Fee Type" description="Renaming only affects this type going forward — any fee structure already created from it keeps its own original label." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Name"><input required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteModal({ feeType, onClose, onDeleted }) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setError("");
    setDeleting(true);
    try {
      await apiRequest(`/fee-types/${feeType.id}`, { method: "DELETE" });
      onDeleted();
      onClose();
    } catch (err) {
      // The backend's 409 message already explains why (structures
      // exist) and suggests deactivating instead — shown as-is rather
      // than a generic failure, since it's the actionable answer.
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal title="Delete Fee Type" description={`This permanently removes "${feeType.name}". This can't be undone.`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-[var(--slate)]">
          Only possible if no fee structure has ever been created from this type. If it's been used, deactivating it instead keeps its history intact.
        </p>
        {error && <p className="rounded-lg bg-[var(--danger-wash)] p-3 text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleDelete} disabled={deleting} className="!bg-[var(--danger)] hover:!bg-[var(--danger)]">
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RowActions({ feeType, onRename, onDelete, onToggleStatus, onToggleApplicability, onManageStudents }) {
  return (
    <RowMenu
      label={`Actions for ${feeType.name}`}
      iconSize={18}
      buttonClassName="h-9 w-9"
      width={208}
      items={[
        { label: "Rename", onClick: onRename },
        { label: `Switch to ${feeType.applicability === "class_wide" ? "selected students" : "all students"}`, onClick: onToggleApplicability },
        feeType.applicability === "selected_students" && { label: "Manage Students", onClick: onManageStudents },
        { label: feeType.status === "active" ? "Deactivate" : "Reactivate", onClick: onToggleStatus },
        { label: "Delete", onClick: onDelete, danger: true, divider: true },
      ]}
    />
  );
}

export default function FeeTypesPage() {
  const [feeTypes, setFeeTypes] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [eligibilityFor, setEligibilityFor] = useState(null);
  const [renameFor, setRenameFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/fee-types?status=all")
      .then((res) => setFeeTypes(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function toggleStatus(feeType) {
    const nextStatus = feeType.status === "active" ? "inactive" : "active";
    try {
      await apiRequest(`/fee-types/${feeType.id}/status`, { method: "PATCH", body: { status: nextStatus } });
      load();
      showToast(nextStatus === "active" ? "Fee type reactivated." : "Fee type deactivated.");
    } catch (err) {
      showToast(err.message, "danger");
    }
  }

  async function toggleApplicability(feeType) {
    const next = feeType.applicability === "class_wide" ? "selected_students" : "class_wide";
    try {
      await apiRequest(`/fee-types/${feeType.id}/applicability`, { method: "PATCH", body: { applicability: next } });
      load();
      showToast(`Now applies to: ${APPLICABILITY_LABELS[next]}.`);
    } catch (err) {
      showToast(err.message, "danger");
    }
  }

  async function changeFrequency(feeType, frequency) {
    try {
      await apiRequest(`/fee-types/${feeType.id}/frequency`, { method: "PATCH", body: { frequency } });
      load();
      showToast(`Frequency set to: ${FREQUENCY_LABELS[frequency]}.`);
    } catch (err) {
      showToast(err.message, "danger");
    }
  }

  function rowActionsFor(t) {
    return (
      <RowActions
        feeType={t}
        onRename={() => setRenameFor(t)}
        onDelete={() => setDeleteFor(t)}
        onToggleStatus={() => toggleStatus(t)}
        onToggleApplicability={() => toggleApplicability(t)}
        onManageStudents={() => setEligibilityFor(t)}
      />
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Fee Types"
        description="The categories of charges this school collects (School Fees, Feeding, Transportation, etc.) — selected when creating a fee structure. Deactivating a type here doesn't affect any structure or invoice already created from it."
      />

      <div className="mt-4"><AddFeeTypeForm onCreated={() => { load(); showToast("Fee type added."); }} /></div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!feeTypes && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {feeTypes && (
        <>
          {/* Phones: stacked cards. */}
          <div className="mt-4 space-y-3 md:hidden">
            {feeTypes.length === 0 && <EmptyState>No fee types yet.</EmptyState>}
            {feeTypes.map((t) => (
              <MobileRecordCard key={t.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="truncate font-medium text-[var(--ink)]">{t.name}</p>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <StatusBadge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : "Inactive"}</StatusBadge>
                    {rowActionsFor(t)}
                  </div>
                </div>
                <p className="mt-1 text-xs text-[var(--slate-quiet)]">{APPLICABILITY_LABELS[t.applicability]}</p>
                <div className="mt-2">
                  <select
                    value={t.frequency} onChange={(e) => changeFrequency(t, e.target.value)}
                    aria-label={`Frequency for ${t.name}`}
                    className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-base text-[var(--slate)] sm:text-xs"
                  >
                    {Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Applies To</th><th className="p-3 font-medium">Frequency</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {feeTypes.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{t.name}</td>
                    <td className="p-3 text-[var(--slate)]">{APPLICABILITY_LABELS[t.applicability]}</td>
                    <td className="p-3">
                      <select
                        value={t.frequency} onChange={(e) => changeFrequency(t, e.target.value)}
                        aria-label={`Frequency for ${t.name}`}
                        className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-base text-[var(--slate)] sm:text-xs"
                      >
                        {Object.entries(FREQUENCY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="p-3"><StatusBadge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : "Inactive"}</StatusBadge></td>
                    <td className="p-3 text-right">{rowActionsFor(t)}</td>
                  </tr>
                ))}
                {feeTypes.length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No fee types yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {eligibilityFor && (
        <EligibilityModal
          feeType={eligibilityFor}
          onClose={() => setEligibilityFor(null)}
          onSaved={() => showToast("Eligible students updated.")}
        />
      )}
      {renameFor && (
        <RenameModal
          feeType={renameFor}
          onClose={() => setRenameFor(null)}
          onRenamed={() => { load(); showToast("Fee type renamed."); }}
        />
      )}
      {deleteFor && (
        <DeleteModal
          feeType={deleteFor}
          onClose={() => setDeleteFor(null)}
          onDeleted={() => { load(); showToast("Fee type deleted."); }}
        />
      )}

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
