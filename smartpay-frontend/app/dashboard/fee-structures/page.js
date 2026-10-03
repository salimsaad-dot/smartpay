"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

function StructureForm({ years, terms, classes, onCreated }) {
  const [academicYearId, setAcademicYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [name, setName] = useState("");
  const [items, setItems] = useState([{ name: "", amount: "" }]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const termsForYear = terms.filter((t) => String(t.academic_year_id) === String(academicYearId));
  const total = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  function updateItem(index, field, value) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { name: "", amount: "" }]);
  }
  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/fee-structures", {
        method: "POST",
        body: {
          academicYearId: Number(academicYearId),
          termId: Number(termId),
          classId: Number(classId),
          name,
          items: items.map((i) => ({ name: i.name, amount: Number(i.amount) })),
        },
      });
      setAcademicYearId(""); setTermId(""); setClassId(""); setName(""); setItems([{ name: "", amount: "" }]);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-[var(--border)] bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className={labelClass}>Academic Year</label>
          <select required value={academicYearId} onChange={(e) => { setAcademicYearId(e.target.value); setTermId(""); }} className={inputClass}>
            <option value="">Select...</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Term</label>
          <select required value={termId} onChange={(e) => setTermId(e.target.value)} className={inputClass} disabled={!academicYearId}>
            <option value="">Select...</option>
            {termsForYear.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Class</label>
          <select required value={classId} onChange={(e) => setClassId(e.target.value)} className={inputClass}>
            <option value="">Select...</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Structure Name</label>
          <input required placeholder="e.g. Term 1 Fees" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="mt-4">
        <label className={labelClass}>Fee Items</label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <input required placeholder="e.g. Tuition" value={item.name} onChange={(e) => updateItem(i, "name", e.target.value)} className={inputClass} />
              <input required type="number" min="0.01" step="0.01" placeholder="Amount" value={item.amount} onChange={(e) => updateItem(i, "amount", e.target.value)} className={`${inputClass} w-40`} />
              {items.length > 1 && (
                <button type="button" onClick={() => removeItem(i)} className="text-xs font-medium text-[var(--danger)]">Remove</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-2 text-xs font-medium text-[var(--primary)] hover:underline">+ Add another fee item</button>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
        <span className="text-sm font-semibold text-[var(--ink)]">Total: {formatMoney(total)}</span>
        <button type="submit" disabled={saving} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          {saving ? "Creating..." : "Create Fee Structure"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

export default function FeeStructuresPage() {
  const { user } = useAuth();
  const [structures, setStructures] = useState(null);
  const [years, setYears] = useState([]);
  const [terms, setTerms] = useState([]);
  const [classes, setClasses] = useState([]);

  function load() {
    apiRequest("/fee-structures").then((res) => setStructures(res.data));
    apiRequest("/academic-years").then((res) => setYears(res.data));
    apiRequest("/terms").then((res) => setTerms(res.data));
    apiRequest("/classes").then((res) => setClasses(res.data));
  }
  useEffect(load, []);

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Fee Structures</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Define what a student in a class/term is expected to pay. Once invoices are generated from a structure, later edits never change those existing invoices.</p>

      <div className="mt-4"><StructureForm years={years} terms={terms} classes={classes} onCreated={load} /></div>

      {structures && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3">Name</th><th className="p-3">Class</th><th className="p-3">Term</th><th className="p-3">Items</th><th className="p-3">Total</th></tr></thead>
            <tbody>
              {structures.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3">{s.class_name}</td>
                  <td className="p-3">{s.term_name}</td>
                  <td className="p-3">{s.item_count}</td>
                  <td className="p-3">{formatMoney(s.total_amount, user?.school.currency)}</td>
                </tr>
              ))}
              {structures.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No fee structures yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
