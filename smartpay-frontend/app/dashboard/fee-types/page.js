"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingSkeleton,
  MobileRecordCard,
  Modal,
  PageHeader,
  StatusBadge,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";

const APPLICABILITY_LABELS = { class_wide: "All students in class", selected_students: "Selected students only" };

function AddFeeTypeForm({ onCreated }) {
  const [name, setName] = useState("");
  const [applicability, setApplicability] = useState("class_wide");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/fee-types", { method: "POST", body: { name, applicability } });
      setName("");
      setApplicability("class_wide");
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

export default function FeeTypesPage() {
  const [feeTypes, setFeeTypes] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [eligibilityFor, setEligibilityFor] = useState(null);
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
                  <StatusBadge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : "Inactive"}</StatusBadge>
                </div>
                <p className="mt-1 text-xs text-[var(--slate-quiet)]">{APPLICABILITY_LABELS[t.applicability]}</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <LinkButton onClick={() => toggleStatus(t)}>{t.status === "active" ? "Deactivate" : "Reactivate"}</LinkButton>
                  <LinkButton onClick={() => toggleApplicability(t)}>Switch to {t.applicability === "class_wide" ? "selected students" : "all students"}</LinkButton>
                  {t.applicability === "selected_students" && <LinkButton onClick={() => setEligibilityFor(t)}>Manage Students</LinkButton>}
                </div>
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Applies To</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {feeTypes.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{t.name}</td>
                    <td className="p-3 text-[var(--slate)]">{APPLICABILITY_LABELS[t.applicability]}</td>
                    <td className="p-3"><StatusBadge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : "Inactive"}</StatusBadge></td>
                    <td className="p-3 text-right">
                      <div className="flex flex-wrap justify-end gap-3">
                        {t.applicability === "selected_students" && <LinkButton onClick={() => setEligibilityFor(t)}>Manage Students</LinkButton>}
                        <LinkButton onClick={() => toggleApplicability(t)}>Switch to {t.applicability === "class_wide" ? "selected" : "all"}</LinkButton>
                        <LinkButton onClick={() => toggleStatus(t)}>{t.status === "active" ? "Deactivate" : "Reactivate"}</LinkButton>
                      </div>
                    </td>
                  </tr>
                ))}
                {feeTypes.length === 0 && (
                  <tr><td colSpan={4} className="p-4 text-center text-[var(--slate-quiet)]">No fee types yet.</td></tr>
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

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
