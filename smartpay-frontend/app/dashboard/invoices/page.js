"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatMoney } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  AmountDisplay,
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingSkeleton,
  MobileRecordCard,
  Modal,
  PageHeader,
  StatusBadge,
  inputClass,
  labelClass,
  statusTone,
} from "@/components/ui";

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
    <form onSubmit={handleGenerate} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="w-full sm:min-w-[260px] sm:w-auto">
        <label className={labelClass}>Fee Structure</label>
        <select required value={feeStructureId} onChange={(e) => setFeeStructureId(e.target.value)} className={inputClass}>
          <option value="">Select a fee structure...</option>
          {structures.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.class_name} · {s.term_name}</option>)}
        </select>
      </div>
      <Button type="submit" disabled={saving}>{saving ? "Generating..." : "Generate Invoices"}</Button>
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
    <Modal
      title="Record Payment"
      description={`${invoice.first_name} ${invoice.last_name} · ${invoice.invoice_no} · Outstanding: ${formatMoney(invoice.balance, currency)}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={labelClass}>Amount</label>
          <input required type="number" min="0.01" step="0.01" max={invoice.balance} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {Object.entries(METHOD_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Reference (optional)</label>
          <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. MoMo transaction ID" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Note (optional)</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </div>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Recording..." : "Record Payment"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// Rendered as a plain block so it works inside a table row on desktop and
// under a card on phones.
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

  if (!payments) return <LoadingSkeleton lines={1} />;

  if (payments.length === 0) {
    return <p className="text-xs text-[var(--slate-quiet)]">No payments recorded for this invoice yet.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--slate-quiet)]">
              <th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Amount</th><th className="py-1 pr-3 font-medium">Method</th>
              <th className="py-1 pr-3 font-medium">Reference</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 pr-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-[var(--border)]">
                <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(p.paid_at)}</td>
                <td className="py-1.5 pr-3"><AmountDisplay amount={p.amount} currency={currency} /></td>
                <td className="py-1.5 pr-3">{METHOD_LABELS[p.method]}</td>
                <td className="py-1.5 pr-3">{p.reference || "—"}</td>
                <td className="py-1.5 pr-3">
                  {p.status === "void" ? <StatusBadge tone="neutral">Voided</StatusBadge> : <StatusBadge tone="success">Active</StatusBadge>}
                </td>
                <td className="py-1.5 pr-3">
                  {p.status !== "void" && (
                    voidingId === p.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          autoFocus
                          type="text"
                          aria-label="Reason for voiding this payment"
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder="Reason..."
                          className="w-32 rounded border border-[var(--border)] px-1.5 py-1 text-xs"
                        />
                        <LinkButton className="text-[var(--danger)]" onClick={() => handleVoid(p.id)}>Confirm</LinkButton>
                        <LinkButton className="text-[var(--slate-quiet)]" onClick={() => { setVoidingId(null); setVoidReason(""); setError(""); }}>Cancel</LinkButton>
                      </div>
                    ) : (
                      <LinkButton className="text-[var(--danger)]" onClick={() => setVoidingId(p.id)}>Void</LinkButton>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [structures, setStructures] = useState([]);
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    setLoadError("");
    apiRequest("/invoices")
      .then((res) => setInvoices(res.data))
      .catch((err) => setLoadError(err.message));
    apiRequest("/fee-structures").then((res) => setStructures(res.data));
  }
  useEffect(load, []);

  const currency = user?.school.currency;

  function toggleHistory(id) {
    setExpandedId(expandedId === id ? null : id);
  }

  function actions(inv) {
    return (
      <div className="flex items-center gap-3">
        <LinkButton onClick={() => toggleHistory(inv.id)}>{expandedId === inv.id ? "Hide" : "History"}</LinkButton>
        {inv.status !== "paid" && inv.status !== "void" && (
          <LinkButton onClick={() => setPayingInvoice(inv)}>Pay</LinkButton>
        )}
      </div>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Invoices"
        description="Generate one invoice per active student from a fee structure. Running it again only bills students who don't already have one."
      />

      <div className="mt-4"><GenerateInvoicesPanel structures={structures} onGenerated={load} /></div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!invoices && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {invoices && (
        <>
          {/* Phones: one card per invoice, history opens inside the card. */}
          <div className="mt-4 space-y-3 md:hidden">
            {invoices.length === 0 && <EmptyState>No invoices generated yet.</EmptyState>}
            {invoices.map((inv) => (
              <MobileRecordCard key={inv.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--slate-quiet)]">{inv.invoice_no}</p>
                    <p className="truncate font-medium text-[var(--ink)]">{inv.first_name} {inv.last_name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{inv.class_name} · Due {formatDate(inv.due_date)}</p>
                  </div>
                  <StatusBadge tone={statusTone(inv.status)}>{STATUS_LABELS[inv.status]}</StatusBadge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-[var(--slate-quiet)]">Total</dt><dd><AmountDisplay amount={inv.total} currency={currency} /></dd></div>
                  <div><dt className="text-[var(--slate-quiet)]">Balance</dt><dd><AmountDisplay amount={inv.balance} currency={currency} tone={Number(inv.balance) > 0 ? "danger" : "default"} /></dd></div>
                </dl>
                <div className="mt-3 border-t border-[var(--border)] pt-3">{actions(inv)}</div>
                {expandedId === inv.id && (
                  <div className="mt-3 rounded-lg bg-[var(--hover)] p-3">
                    <PaymentsPanel invoice={inv} currency={currency} onChanged={load} />
                  </div>
                )}
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: full table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Invoice No.</th><th className="p-3 font-medium">Student</th><th className="p-3 font-medium">Class</th>
                  <th className="p-3 font-medium">Due</th><th className="p-3 font-medium">Total</th><th className="p-3 font-medium">Balance</th><th className="p-3 font-medium">Status</th>
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
                      <td className="p-3"><AmountDisplay amount={inv.total} currency={currency} /></td>
                      <td className="p-3"><AmountDisplay amount={inv.balance} currency={currency} tone={Number(inv.balance) > 0 ? "danger" : "default"} /></td>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <StatusBadge tone={statusTone(inv.status)}>{STATUS_LABELS[inv.status]}</StatusBadge>
                          {actions(inv)}
                        </div>
                      </td>
                    </tr>
                    {expandedId === inv.id && (
                      <tr className="border-b border-[var(--border)] bg-[var(--hover)]">
                        <td colSpan={7} className="p-3">
                          <PaymentsPanel invoice={inv} currency={currency} onChanged={load} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {invoices.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--slate-quiet)]">No invoices generated yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
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
