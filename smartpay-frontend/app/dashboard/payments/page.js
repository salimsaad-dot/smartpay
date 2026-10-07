"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatMoney } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  AmountDisplay,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingSkeleton,
  MobileRecordCard,
  Modal,
  PageHeader,
  StatusBadge,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";

const METHOD_LABELS = { cash: "Cash", mobile_money: "Mobile Money", bank_transfer: "Bank Transfer", other: "Other" };

// Step 1 of Record Payment: pick which outstanding invoice this payment
// is against. This page isn't launched from inside a specific invoice
// (that's the Invoices page's own "Pay" action) — it's the standalone
// entry point, so it needs its own invoice picker first. Fetches once,
// filters client-side on typed text, same "fetch once, filter in the
// browser" pattern already used elsewhere in this app (Students, Parents).
function InvoicePicker({ onPick, onCancel }) {
  const [invoices, setInvoices] = useState(null);
  const [search, setSearch] = useState("");
  const { user } = useAuth();
  const currency = user?.school.currency;

  useEffect(() => {
    apiRequest("/invoices").then((res) => setInvoices(res.data.filter((i) => i.status !== "paid" && i.status !== "void")));
  }, []);

  const filtered = useMemo(() => {
    if (!invoices) return [];
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((i) =>
      `${i.first_name} ${i.last_name}`.toLowerCase().includes(q) ||
      i.invoice_no.toLowerCase().includes(q) ||
      i.class_name.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  return (
    <Modal title="Record Payment" description="Pick the invoice this payment is for" onClose={onCancel}>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--slate-quiet)]" />
        <input
          autoFocus
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student, invoice no., or class..."
          className={`${inputClass} pl-9`}
        />
      </div>
      {!invoices ? (
        <div className="mt-3"><LoadingSkeleton lines={3} /></div>
      ) : filtered.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--slate-quiet)]">No outstanding invoices match.</p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
          {filtered.map((inv) => (
            <li key={inv.id}>
              <button
                type="button"
                onClick={() => onPick(inv)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--hover)]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--ink)]">{inv.first_name} {inv.last_name}</span>
                  <span className="block truncate text-xs text-[var(--slate-quiet)]">{inv.invoice_no} · {inv.class_name}</span>
                </span>
                <span className="flex-shrink-0 text-xs font-medium text-[var(--danger)]">{formatMoney(inv.balance, currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// Step 2: same fields as the Invoices page's own in-context Record
// Payment form, deliberately kept as its own copy rather than a shared
// import — matches this codebase's existing convention of each page
// owning its own form rather than cross-page component sharing.
function RecordPaymentForm({ invoice, currency, onClose, onSaved }) {
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
        <Field label="Amount">
          <input required type="number" min="0.01" step="0.01" max={invoice.balance} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {Object.entries(METHOD_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        </Field>
        <Field label="Reference (optional)">
          <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. MoMo transaction ID" className={inputClass} />
        </Field>
        <Field label="Note (optional)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Recording..." : "Record Payment"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RecordPaymentFlow({ currency, onClose, onSaved }) {
  const [invoice, setInvoice] = useState(null);
  if (!invoice) return <InvoicePicker onPick={setInvoice} onCancel={onClose} />;
  return <RecordPaymentForm invoice={invoice} currency={currency} onClose={onClose} onSaved={onSaved} />;
}

function VoidAction({ payment, onVoided, onToast }) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  if (payment.status === "void") return <StatusBadge tone="neutral">Voided</StatusBadge>;

  if (!voiding) {
    return <LinkButton className="text-[var(--danger)]" onClick={() => setVoiding(true)}>Void</LinkButton>;
  }

  async function confirm() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    try {
      await apiRequest(`/payments/${payment.id}/void`, { method: "POST", body: { reason } });
      onVoided();
      onToast("Payment voided.");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        type="text"
        aria-label="Reason for voiding this payment"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason..."
        className="w-32 rounded border border-[var(--border)] px-1.5 py-1 text-xs"
      />
      <LinkButton className="text-[var(--danger)]" onClick={confirm}>Confirm</LinkButton>
      <LinkButton className="text-[var(--slate-quiet)]" onClick={() => { setVoiding(false); setReason(""); setError(""); }}>Cancel</LinkButton>
      {error && <p className="w-full text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const currency = user?.school.currency;
  const [payments, setPayments] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (method) params.set("method", method);
    apiRequest(`/payments?${params.toString()}`)
      .then((res) => setPayments(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, [startDate, endDate, method]);

  const filtered = useMemo(() => {
    if (!payments) return [];
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      p.invoice_no.toLowerCase().includes(q) ||
      (p.reference || "").toLowerCase().includes(q)
    );
  }, [payments, search]);

  const totalCollected = useMemo(
    () => filtered.filter((p) => p.status !== "void").reduce((sum, p) => sum + Number(p.amount), 0),
    [filtered]
  );

  function handleRecorded() {
    setRecording(false);
    load();
    showToast("Payment recorded.");
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Payments"
        description="Every payment recorded against any invoice, across all classes and terms."
        action={<Button onClick={() => setRecording(true)}>Record Payment</Button>}
      />

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4">
        <Field label="From" className="w-full sm:w-auto">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="To" className="w-full sm:w-auto">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Method" className="w-full sm:w-auto">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            <option value="">All methods</option>
            {Object.entries(METHOD_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        </Field>
        <div className="relative w-full flex-1 sm:min-w-[220px] sm:w-auto">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--slate-quiet)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by student, invoice no., or reference..."
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!payments && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {payments && (
        <>
          <p className="mt-4 text-sm text-[var(--slate-quiet)]">
            {filtered.length} payment{filtered.length !== 1 ? "s" : ""} · Total collected: <AmountDisplay amount={totalCollected} currency={currency} />
          </p>

          {/* Phones: one card per payment. */}
          <div className="mt-4 space-y-3 md:hidden">
            {filtered.length === 0 && <EmptyState>No payments match.</EmptyState>}
            {filtered.map((p) => (
              <MobileRecordCard key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ink)]">{p.first_name} {p.last_name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{p.invoice_no} · {formatDate(p.paid_at)}</p>
                  </div>
                  <AmountDisplay amount={p.amount} currency={currency} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-[var(--slate-quiet)]">Method</dt><dd>{METHOD_LABELS[p.method]}</dd></div>
                  <div><dt className="text-[var(--slate-quiet)]">Reference</dt><dd className="truncate">{p.reference || "—"}</dd></div>
                </dl>
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <VoidAction payment={p} onVoided={load} onToast={showToast} />
                </div>
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: full table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Student</th><th className="p-3 font-medium">Invoice No.</th>
                  <th className="p-3 font-medium">Amount</th><th className="p-3 font-medium">Method</th><th className="p-3 font-medium">Reference</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 whitespace-nowrap">{formatDate(p.paid_at)}</td>
                    <td className="p-3 font-medium">{p.first_name} {p.last_name}</td>
                    <td className="p-3 font-mono text-xs">{p.invoice_no}</td>
                    <td className="p-3"><AmountDisplay amount={p.amount} currency={currency} /></td>
                    <td className="p-3">{METHOD_LABELS[p.method]}</td>
                    <td className="p-3 text-xs text-[var(--slate-quiet)]">{p.reference || "—"}</td>
                    <td className="p-3"><VoidAction payment={p} onVoided={load} onToast={showToast} /></td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--slate-quiet)]">No payments match.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {recording && (
        <RecordPaymentFlow currency={currency} onClose={() => setRecording(false)} onSaved={handleRecorded} />
      )}

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
