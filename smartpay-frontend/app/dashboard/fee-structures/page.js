"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  AmountDisplay,
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

function StructureForm({ years, terms, classes, currency, onCreated }) {
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
    <form onSubmit={handleSubmit} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              <input required type="number" min="0.01" step="0.01" placeholder="Amount" value={item.amount} onChange={(e) => updateItem(i, "amount", e.target.value)} className={`${inputClass} w-28 sm:w-40`} />
              {items.length > 1 && (
                <button type="button" onClick={() => removeItem(i)} aria-label={`Remove fee item ${i + 1}`} className="flex min-h-[44px] items-center text-xs font-medium text-[var(--danger)] sm:min-h-0">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-2 flex min-h-[44px] items-center text-xs font-medium text-[var(--primary)] hover:underline sm:min-h-0">
          + Add another fee item
        </button>
      </div>

      {/* The running total is the most prominent thing in the builder, per spec. */}
      <div className="mt-3 flex flex-col gap-3 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-[var(--slate-quiet)]">Total</p>
          <AmountDisplay amount={total} currency={currency} size="lg" />
        </div>
        <Button type="submit" disabled={saving}>{saving ? "Creating..." : "Create Fee Structure"}</Button>
      </div>
      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

export default function FeeStructuresPage() {
  const { user } = useAuth();
  const [structures, setStructures] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [years, setYears] = useState([]);
  const [terms, setTerms] = useState([]);
  const [classes, setClasses] = useState([]);
  const { toast, showToast, dismissToast } = useToast();

  const currency = user?.school.currency;

  function load() {
    setLoadError("");
    apiRequest("/fee-structures")
      .then((res) => setStructures(res.data))
      .catch((err) => setLoadError(err.message));
    apiRequest("/academic-years").then((res) => setYears(res.data));
    apiRequest("/terms").then((res) => setTerms(res.data));
    apiRequest("/classes").then((res) => setClasses(res.data));
  }
  useEffect(load, []);

  function handleCreated() {
    load();
    showToast("Fee structure created.");
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Fee Structures"
        description="Define what a student in a class/term is expected to pay. Once invoices are generated from a structure, later edits never change those existing invoices."
      />

      <div className="mt-4"><StructureForm years={years} terms={terms} classes={classes} currency={currency} onCreated={handleCreated} /></div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!structures && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {structures && (
        <>
          {/* Phones: stacked cards. */}
          <div className="mt-4 space-y-3 md:hidden">
            {structures.length === 0 && <EmptyState>No fee structures yet.</EmptyState>}
            {structures.map((s) => (
              <MobileRecordCard key={s.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ink)]">{s.name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{s.class_name} · {s.term_name}</p>
                  </div>
                  <AmountDisplay amount={s.total_amount} currency={currency} size="lg" />
                </div>
                <p className="mt-2 text-xs text-[var(--slate-quiet)]">{s.item_count} fee item{s.item_count === 1 ? "" : "s"}</p>
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Class</th><th className="p-3 font-medium">Term</th>
                  <th className="p-3 font-medium">Items</th><th className="p-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {structures.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{s.name}</td>
                    <td className="p-3">{s.class_name}</td>
                    <td className="p-3">{s.term_name}</td>
                    <td className="p-3">{s.item_count}</td>
                    <td className="p-3"><AmountDisplay amount={s.total_amount} currency={currency} /></td>
                  </tr>
                ))}
                {structures.length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No fee structures yet.</td></tr>
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
