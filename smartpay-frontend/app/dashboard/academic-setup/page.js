"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

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
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] bg-white p-4 sm:grid-cols-4">
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
        <button type="submit" disabled={saving} className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          {saving ? "Adding..." : "Add Year"}
        </button>
      </div>
      {error && <p className="sm:col-span-4 text-sm text-[var(--danger)]">{error}</p>}
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
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] bg-white p-4 sm:grid-cols-5">
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
        <button type="submit" disabled={saving} className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          {saving ? "Adding..." : "Add Term"}
        </button>
      </div>
      {error && <p className="sm:col-span-5 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

export default function AcademicSetupPage() {
  const [years, setYears] = useState(null);
  const [terms, setTerms] = useState(null);

  function load() {
    apiRequest("/academic-years").then((res) => setYears(res.data));
    apiRequest("/terms").then((res) => setTerms(res.data));
  }
  useEffect(load, []);

  async function setCurrentYear(id) {
    await apiRequest(`/academic-years/${id}/set-current`, { method: "PATCH" });
    load();
  }
  async function setCurrentTerm(id) {
    await apiRequest(`/terms/${id}/set-current`, { method: "PATCH" });
    load();
  }

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Academic Setup</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Create academic years and terms, and mark which one is currently active.</p>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--slate-quiet)]">Academic Years</h2>
      <div className="mt-2"><YearForm onCreated={load} /></div>
      {years && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3">Name</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Current</th><th className="p-3"></th></tr></thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">{y.name}</td>
                  <td className="p-3">{formatDate(y.start_date)}</td>
                  <td className="p-3">{formatDate(y.end_date)}</td>
                  <td className="p-3">{y.is_current ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-[var(--success)]">Current</span> : "—"}</td>
                  <td className="p-3 text-right">
                    {!y.is_current && <button onClick={() => setCurrentYear(y.id)} className="text-xs font-medium text-[var(--primary)] hover:underline">Set Current</button>}
                  </td>
                </tr>
              ))}
              {years.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No academic years yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--slate-quiet)]">Terms</h2>
      <div className="mt-2"><TermForm years={years || []} onCreated={load} /></div>
      {terms && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3">Name</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Current</th><th className="p-3"></th></tr></thead>
            <tbody>
              {terms.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">{t.name}</td>
                  <td className="p-3">{formatDate(t.start_date)}</td>
                  <td className="p-3">{formatDate(t.end_date)}</td>
                  <td className="p-3">{t.is_current ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-[var(--success)]">Current</span> : "—"}</td>
                  <td className="p-3 text-right">
                    {!t.is_current && <button onClick={() => setCurrentTerm(t.id)} className="text-xs font-medium text-[var(--primary)] hover:underline">Set Current</button>}
                  </td>
                </tr>
              ))}
              {terms.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No terms yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
