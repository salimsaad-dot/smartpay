"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  MobileRecordCard,
  PageHeader,
  Toast,
  inputClass,
  labelClass,
  useToast,
} from "@/components/ui";

export default function ClassesPage() {
  const [classes, setClasses] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ name: "", level: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/classes")
      .then((res) => setClasses(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/classes", { method: "POST", body: { name: form.name, level: form.level ? Number(form.level) : undefined } });
      setForm({ name: "", level: "" });
      load();
      showToast("Class added.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell>
      <PageHeader title="Classes" description="The set of classes students can be placed in, e.g. Basic 1, Basic 2, JHS 1." />

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)] sm:grid-cols-3">
        <div>
          <label className={labelClass}>Class Name</label>
          <input required placeholder="e.g. Basic 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Level (optional, for sort order)</label>
          <input type="number" placeholder="e.g. 1" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} className={inputClass} />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={saving} className="w-full">{saving ? "Adding..." : "Add Class"}</Button>
        </div>
        {error && <p className="sm:col-span-3 text-sm text-[var(--danger)]">{error}</p>}
      </form>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!classes && !loadError && <div className="mt-6"><LoadingSkeleton lines={2} /></div>}

      {classes && (
        <>
          <div className="mt-4 space-y-2 md:hidden">
            {classes.length === 0 && <EmptyState>No classes yet.</EmptyState>}
            {classes.map((c) => (
              <MobileRecordCard key={c.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-[var(--ink)]">{c.name}</p>
                  <p className="text-xs text-[var(--slate-quiet)]">{c.level != null ? `Level ${c.level}` : "No level set"}</p>
                </div>
              </MobileRecordCard>
            ))}
          </div>

          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Level</th></tr></thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3">{c.level ?? "—"}</td>
                  </tr>
                ))}
                {classes.length === 0 && <tr><td colSpan={2} className="p-4 text-center text-[var(--slate-quiet)]">No classes yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
