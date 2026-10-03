"use client";

import { Fragment, useEffect, useState } from "react";
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
const METHOD_LABELS = { cash: "Cash", mobile_money: "Mobile Money", bank_transfer: "Bank Transfer", other: "Other" };

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

function RecordPaymentModal({ invoice, currency, onClose, onSaved }) {
  const [amount, setAmount] = useState(invoice.balance);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/payments", {
        method: "POST",
        body: { invoiceId: invoice.id, amount: Number(amount), method, reference: reference || undefined, note: note || undefined },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Record Payment</h2>
        <p className="mt-1 text-sm text-[var(--slate-quiet)]">
          {invoice.first_name} {invoice.last_name} · {invoice.invoice_no} · Outstanding: {formatMoney(invoice.balance, currency)}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--slate-quiet)]">Amount</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              max={invoice.balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--slate-quiet)]">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            >
              {Object.entries(METHOD_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--slate-quiet)]">Reference (optional)</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. MoMo transaction ID"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--slate-quiet)]">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--slate-quiet)] hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
              {saving ? "Recording..." : "Record Payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PaymentsPanel({ invoice, currency, onChanged }) {
  const [payments, setPayments] = useState(null);
  const [voidingId, setVoidingId] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState("");

  function load() {
    apiRequest(`/payments?invoiceId=${invoice.id}`).then((res) => setPayments(res.data));
  }
  useEffect(load, [invoice.id]);

  async function handleVoid(paymentId) {
    setError("");
    if (!voidReason.trim()) {
      setError("A reason is required to void a payment.");
      return;
    }
    try {
      await apiRequest(`/payments/${paymentId}/void`, { method: "POST", body: { reason: voidReason } });
      setVoidingId(null);
      setVoidReason("");
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!payments) return <tr><td colSpan={7} className="p-3 text-center text-xs text-[var(--slate-quiet)]">Loading payments...</td></tr>;

  return (
    <tr className="border-b border-[var(--border)] bg-gray-50">
      <td colSpan={7} className="p-3">
        {payments.length === 0 ? (
          <p className="text-xs text-[var(--slate-quiet)]">No payments recorded for this invoice yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--slate-quiet)]">
                <th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Amount</th><th className="py-1 pr-3">Method</th>
                <th className="py-1 pr-3">Reference</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-3">{formatDate(p.paid_at)}</td>
                  <td className="py-1.5 pr-3">{formatMoney(p.amount, currency)}</td>
                  <td className="py-1.5 pr-3">{METHOD_LABELS[p.method]}</td>
                  <td className="py-1.5 pr-3">{p.reference || "—"}</td>
                  <td className="py-1.5 pr-3">
                    {p.status === "void" ? (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[var(--slate-quiet)]">Voided</span>
                    ) : (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[var(--success)]">Active</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {p.status !== "void" && (
                      voidingId === p.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            placeholder="Reason..."
                            className="w-32 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs"
                          />
                          <button onClick={() => handleVoid(p.id)} className="text-[var(--danger)] hover:underline">Confirm</button>
                          <button onClick={() => { setVoidingId(null); setVoidReason(""); setError(""); }} className="text-[var(--slate-quiet)] hover:underline">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setVoidingId(p.id)} className="text-[var(--danger)] hover:underline">Void</button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </td>
    </tr>
  );
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState(null);
  const [structures, setStructures] = useState([]);
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    apiRequest("/invoices").then((res) => setInvoices(res.data));
    apiRequest("/fee-structures").then((res) => setStructures(res.data));
  }
  useEffect(load, []);

  const currency = user?.school.currency;

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
                <Fragment key={inv.id}>
                  <tr className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-mono text-xs">{inv.invoice_no}</td>
                    <td className="p-3 font-medium">{inv.first_name} {inv.last_name}</td>
                    <td className="p-3">{inv.class_name}</td>
                    <td className="p-3">{formatDate(inv.due_date)}</td>
                    <td className="p-3">{formatMoney(inv.total, currency)}</td>
                    <td className="p-3">{formatMoney(inv.balance, currency)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[inv.status]}`}>{STATUS_LABELS[inv.status]}</span>
                        <button
                          onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                          className="text-xs text-[var(--primary)] hover:underline"
                        >
                          {expandedId === inv.id ? "Hide" : "History"}
                        </button>
                        {inv.status !== "paid" && inv.status !== "void" && (
                          <button
                            onClick={() => setPayingInvoice(inv)}
                            className="text-xs font-semibold text-[var(--primary)] hover:underline"
                          >
                            Pay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === inv.id && (
                    <PaymentsPanel invoice={inv} currency={currency} onChanged={load} />
                  )}
                </Fragment>
              ))}
              {invoices.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--slate-quiet)]">No invoices generated yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {payingInvoice && (
        <RecordPaymentModal
          invoice={payingInvoice}
          currency={currency}
          onClose={() => setPayingInvoice(null)}
          onSaved={load}
        />
      )}
    </DashboardShell>
  );
}
