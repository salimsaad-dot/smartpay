"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney, formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const STATUS_STYLES = {
  unpaid: "bg-red-50 text-[var(--danger)]",
  partially_paid: "bg-amber-50 text-amber-700",
  paid: "bg-green-50 text-[var(--success)]",
  void: "bg-gray-100 text-[var(--slate-quiet)]",
};
const STATUS_LABELS = { unpaid: "Unpaid", partially_paid: "Partially Paid", paid: "Paid", void: "Void" };

function GenerateInvoicesPanel({ structures, onGenerated }) {
  const [feeStructureId, setFeeStructureId] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleGenerate(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    setSaving(true);
    try {
      const res = await apiRequest("/invoices/generate", { method: "POST", body: { feeStructureId: Number(feeStructureId) } });
      setResult(res.data);
      onGenerated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleGenerate} className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-white p-4">
      <div className="min-w-[260px]">
        <label className="mb-1 block text-xs font-medium text-[var(--slate-quiet)]">Fee Structure</label>
        <select
          required
          value={feeStructureId}
          onChange={(e) => setFeeStructureId(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
        >
          <option value="">Select a fee structure...</option>
          {structures.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.class_name} · {s.term_name}</option>)}
        </select>
      </div>
      <button type="submit" disabled={saving} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
        {saving ? "Generating..." : "Generate Invoices"}
      </button>
      {result && (
        <p className="w-full text-sm text-[var(--slate)]">
          Created {result.created} new invoice(s){result.skipped > 0 ? `, skipped ${result.skipped} (already billed)` : ""} out of {result.totalEligibleStudents} eligible student(s).
        </p>
      )}
      {error && <p className="w-full text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState(null);
  const [structures, setStructures] = useState([]);

  function load() {
    apiRequest("/invoices").then((res) => setInvoices(res.data));
    apiRequest("/fee-structures").then((res) => setStructures(res.data));
  }
  useEffect(load, []);

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Invoices</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Generate one invoice per active student from a fee structure. Running it again only bills students who don&apos;t already have one.</p>

      <div className="mt-4"><GenerateInvoicesPanel structures={structures} onGenerated={load} /></div>

      {invoices && (
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-3">Invoice No.</th><th className="p-3">Student</th><th className="p-3">Class</th>
                <th className="p-3">Due</th><th className="p-3">Total</th><th className="p-3">Balance</th><th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-mono text-xs">{inv.invoice_no}</td>
                  <td className="p-3 font-medium">{inv.first_name} {inv.last_name}</td>
                  <td className="p-3">{inv.class_name}</td>
                  <td className="p-3">{formatDate(inv.due_date)}</td>
                  <td className="p-3">{formatMoney(inv.total, user?.school.currency)}</td>
                  <td className="p-3">{formatMoney(inv.balance, user?.school.currency)}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[inv.status]}`}>{STATUS_LABELS[inv.status]}</span></td>
                </tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--slate-quiet)]">No invoices generated yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
