"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingSkeleton,
  MobileRecordCard,
  PageHeader,
  StatusBadge,
  Toast,
  inputClass,
  labelClass,
  useToast,
} from "@/components/ui";

function YearForm({ onCreated }) {
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/academic-years", { method: "POST", body: form });
      setForm({ name: "", startDate: "", endDate: "" });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className={labelClass}>Year Name</label>
        <input required placeholder="e.g. 2026/2027" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Start Date</label>
        <input required type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>End Date</label>
        <input required type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Adding..." : "Add Year"}</Button>
      </div>
      {error && <p className="sm:col-span-2 lg:col-span-4 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

function TermForm({ years, onCreated }) {
  const [form, setForm] = useState({ academicYearId: "", name: "", startDate: "", endDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/terms", { method: "POST", body: { ...form, academicYearId: Number(form.academicYearId) } });
      setForm({ academicYearId: "", name: "", startDate: "", endDate: "" });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-5">
      <div>
        <label className={labelClass}>Academic Year</label>
        <select required value={form.academicYearId} onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))} className={inputClass}>
          <option value="">Select...</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelClass}>Term Name</label>
        <input required placeholder="e.g. Term 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Start Date</label>
        <input required type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>End Date</label>
        <input required type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Adding..." : "Add Term"}</Button>
      </div>
      {error && <p className="sm:col-span-2 lg:col-span-5 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

// Shared shape for both the Academic Years and Terms lists — same columns,
// same "set current" action, same mobile-card/desktop-table split.
function PeriodList({ items, onSetCurrent }) {
  if (!items) return <LoadingSkeleton lines={2} />;

  return (
    <>
      <div className="space-y-2 md:hidden">
        {items.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
        {items.map((item) => (
          <MobileRecordCard key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--ink)]">{item.name}</p>
                <p className="text-xs text-[var(--slate-quiet)]">{formatDate(item.start_date)} – {formatDate(item.end_date)}</p>
              </div>
              {item.is_current ? (
                <StatusBadge tone="success">Current</StatusBadge>
              ) : (
                <LinkButton onClick={() => onSetCurrent(item.id)}>Set Current</LinkButton>
              )}
            </div>
          </MobileRecordCard>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Start</th><th className="p-3 font-medium">End</th><th className="p-3 font-medium">Current</th><th className="p-3 font-medium"></th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="p-3 font-medium">{item.name}</td>
                <td className="p-3">{formatDate(item.start_date)}</td>
                <td className="p-3">{formatDate(item.end_date)}</td>
                <td className="p-3">{item.is_current ? <StatusBadge tone="success">Current</StatusBadge> : "—"}</td>
                <td className="p-3 text-right">
                  {!item.is_current && <LinkButton onClick={() => onSetCurrent(item.id)}>Set Current</LinkButton>}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function AcademicSetupPage() {
  const [years, setYears] = useState(null);
  const [terms, setTerms] = useState(null);
  const [loadError, setLoadError] = useState("");
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/academic-years")
      .then((res) => setYears(res.data))
      .catch((err) => setLoadError(err.message));
    apiRequest("/terms")
      .then((res) => setTerms(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function setCurrentYear(id) {
    await apiRequest(`/academic-years/${id}/set-current`, { method: "PATCH" });
    load();
    showToast("Academic year set as current.");
  }
  async function setCurrentTerm(id) {
    await apiRequest(`/terms/${id}/set-current`, { method: "PATCH" });
    load();
    showToast("Term set as current.");
  }

  return (
    <DashboardShell>
      <PageHeader title="Academic Setup" description="Create academic years and terms, and mark which one is currently active." />

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--slate-quiet)]">Academic Years</h2>
      <div className="mt-2"><YearForm onCreated={() => { load(); showToast("Academic year added."); }} /></div>
      <div className="mt-3"><PeriodList items={years} onSetCurrent={setCurrentYear} /></div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--slate-quiet)]">Terms</h2>
      <div className="mt-2"><TermForm years={years || []} onCreated={() => { load(); showToast("Term added."); }} /></div>
      <div className="mt-3"><PeriodList items={terms} onSetCurrent={setCurrentTerm} /></div>

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
