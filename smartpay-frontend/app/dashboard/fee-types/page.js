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
  PageHeader,
  StatusBadge,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";

function AddFeeTypeForm({ onCreated }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/fee-types", { method: "POST", body: { name } });
      setName("");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <Field label="New Fee Type" className="w-full sm:min-w-[260px] sm:w-auto">
        <input required placeholder="e.g. Sports Levy" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <Button type="submit" disabled={saving}>{saving ? "Adding..." : "Add Fee Type"}</Button>
      {error && <p className="w-full text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

export default function FeeTypesPage() {
  const [feeTypes, setFeeTypes] = useState(null);
  const [loadError, setLoadError] = useState("");
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
                <div className="mt-2">
                  <LinkButton onClick={() => toggleStatus(t)}>{t.status === "active" ? "Deactivate" : "Reactivate"}</LinkButton>
                </div>
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {feeTypes.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{t.name}</td>
                    <td className="p-3"><StatusBadge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : "Inactive"}</StatusBadge></td>
                    <td className="p-3 text-right"><LinkButton onClick={() => toggleStatus(t)}>{t.status === "active" ? "Deactivate" : "Reactivate"}</LinkButton></td>
                  </tr>
                ))}
                {feeTypes.length === 0 && (
                  <tr><td colSpan={3} className="p-4 text-center text-[var(--slate-quiet)]">No fee types yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
