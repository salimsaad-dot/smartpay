"use client";

// Payment and reminder dialogs shared by the Invoices, Arrears and Students
// pages, so recording a payment or texting a parent behaves identically
// wherever it's started from (moved here 2026-10-14 when the Students page
// gained a per-student account view).
import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle, TriangleAlert } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
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

// wa.me wants the number in international form with digits only. Ghana
// numbers are stored as typed (0241234567, +233 24..., 233...); anything
// that doesn't look like one opens WhatsApp's contact picker instead.
function whatsappNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  if (/^233\d{9}$/.test(digits)) return digits;
  return "";
}

// "Get payment link" (Arrears and Parents pages). A link lets a parent pay
// online without an SMS: the school sends it on WhatsApp, by email, or reads
// it out. A parent has one working link at a time, so making a new one
// cancels the link in their last reminder; the dialog says so BEFORE making
// it (2026-10-18; it used to make the link on click with no explanation).
export function PaymentLinkModal({ parentId, parentName, parentPhone, childNames, schoolName, onClose }) {
  const [link, setLink] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    setCreating(true);
    setError("");
    try {
      const res = await apiRequest(`/parents/${parentId}/payment-link`, { method: "POST" });
      setLink(res.data);
    } catch (err) {
      setError(err.message);
    }
    setCreating(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      // Clipboard blocked: the full link is on screen to select by hand.
    }
  }

  const children = childNames?.length ? childNames.join(" and ") : "your child";
  const message = link && [
    `Hello${parentName ? ` ${parentName}` : ""}, here is your secure link to pay ${children}'s fees${schoolName ? ` at ${schoolName}` : ""}:`,
    link.url,
    `You can pay with Mobile Money or card. The link works until ${formatDate(link.expiresAt)}.`,
  ].join("\n\n");
  const whatsappHref = link && `https://wa.me/${whatsappNumber(parentPhone)}?text=${encodeURIComponent(message)}`;

  return (
    <Modal
      title="Payment link"
      description={parentName ? `For ${parentName}` : undefined}
      onClose={onClose}
    >
      {error && <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
      {!link ? (
        <div className="space-y-3 text-sm text-[var(--slate)]">
          <p>
            A private page where this parent sees what they owe and pays online by Mobile Money or card. Send it yourself, on
            WhatsApp or any other way. It uses no SMS.
          </p>
          <p className="flex gap-2 rounded-lg bg-[var(--warning-wash)] p-3 text-[var(--ink)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <span>A parent has one working link at a time. Making a new one stops the link in their last SMS reminder from working.</span>
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={create} disabled={creating}>{creating ? "Creating..." : "Create link"}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="break-all rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs text-[var(--ink)]">{link.url}</p>
          <p className="text-xs text-[var(--slate-quiet)]">Works until {formatDate(link.expiresAt)}, or until a newer link or reminder replaces it.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="secondary" className="gap-2" onClick={copy}>
              {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy link</>}
            </Button>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-white hover:opacity-90 sm:min-h-[40px]"
            >
              <MessageCircle size={16} /> Share on WhatsApp
            </a>
          </div>
          {!whatsappNumber(parentPhone) && (
            <p className="text-xs text-[var(--slate-quiet)]">No usable phone number on file, so WhatsApp will ask you to pick the contact.</p>
          )}
        </div>
      )}
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
