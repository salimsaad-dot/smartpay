"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

export default function ClassesPage() {
  const [classes, setClasses] = useState(null);
  const [form, setForm] = useState({ name: "", level: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    apiRequest("/classes").then((res) => setClasses(res.data));
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
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Classes</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">The set of classes students can be placed in, e.g. Basic 1, Basic 2, JHS 1.</p>

      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] bg-white p-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Class Name</label>
          <input required placeholder="e.g. Basic 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Level (optional, for sort order)</label>
          <input type="number" placeholder="e.g. 1" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} className={inputClass} />
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={saving} className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
            {saving ? "Adding..." : "Add Class"}
          </button>
        </div>
        {error && <p className="sm:col-span-3 text-sm text-[var(--danger)]">{error}</p>}
      </form>

      {classes && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3">Name</th><th className="p-3">Level</th></tr></thead>
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
      )}
    </DashboardShell>
  );
}
