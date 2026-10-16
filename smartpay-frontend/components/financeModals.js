"use client";

// Payment and reminder dialogs shared by the Invoices, Arrears and Students
// pages, so recording a payment or texting a parent behaves identically
// wherever it's started from (moved here 2026-10-14 when the Students page
// gained a per-student account view).
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { Button, Field, Modal, inputClass } from "@/components/ui";

export const METHOD_LABELS = { cash: "Cash", mobile_money: "Mobile Money", bank_transfer: "Bank Transfer", other: "Other" };

// One ID per opening of the dialog, sent with the payment. If the same
// submission reaches the server twice (double-click, a retry after the
// network dropped the reply), the backend recognises the ID and returns the
// payment it already recorded instead of saving a second one.
function newSubmissionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function RecordPaymentModal({ invoice, currency, onClose, onSaved }) {
  const [submissionId] = useState(newSubmissionId);
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
        body: { invoiceId: invoice.id, amount: Number(amount), method, reference: reference || undefined, note: note || undefined, idempotencyKey: submissionId },
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
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Recording..." : "Record Payment"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SendReminderModal({ parentId, studentId, label, onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  // Scoped to the student, not the one invoice the admin clicked from —
  // a parent clicking "Send Reminder" from any of a student's rows
  // expects the message to cover everything that student owes (real
  // confusion caught live: clicking from a Graduation Fees row sent a
  // reminder mentioning only Graduation Fees, with no indication the
  // same student also had an outstanding Feeding invoice). Siblings
  // still require the separate parent-grouped "Send Reminder" action.
  useEffect(() => {
    apiRequest("/reminders/preview", { method: "POST", body: { parentId, studentId } })
      .then((res) => setPreview(res.data))
      .catch((err) => setError(err.message));
  }, [parentId, studentId]);

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      await apiRequest("/reminders/send", { method: "POST", body: { parentId, studentId } });
      setResult("success");
    } catch (err) {
      setError(err.message);
      setResult("failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Send Reminder" description={label} onClose={onClose}>
      {!preview && !error && <p className="text-sm text-[var(--slate-quiet)]">Loading preview...</p>}

      {preview && !result && (
        <>
          <p className="text-xs text-[var(--slate-quiet)]">To: {preview.phone}</p>
          <div className="mt-1 rounded-lg bg-[var(--hover)] p-3 text-sm text-[var(--ink)]">{preview.message}</div>
          {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending}>{sending ? "Sending..." : "Confirm & Send"}</Button>
          </div>
        </>
      )}

      {result === "success" && (
        <>
          <p className="text-sm text-[var(--success)]">Reminder sent.</p>
          <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </>
      )}
      {result === "failed" && (
        <>
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </>
      )}

      {error && !preview && (
        <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      )}
    </Modal>
  );
}
