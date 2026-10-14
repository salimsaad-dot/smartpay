"use client";

// One student's fee account, opened by tapping a student on the Students
// page: what they owe, every invoice, and their payment history, without
// going to the Invoices or Payments pages. Requested by a headmaster
// reviewing SmartPay (2026-10-14). Record Payment and Send Reminder reuse
// the shared dialogs from financeModals.js; while one is open it replaces
// this panel (rather than stacking on top, where Escape would close both),
// then the account reloads with the new figures.
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { Button, LinkButton, LoadingSkeleton, Modal, StatusBadge, statusTone } from "@/components/ui";
import { METHOD_LABELS, RecordPaymentModal, SendReminderModal } from "@/components/financeModals";

const STATUS_LABELS = { unpaid: "Unpaid", partially_paid: "Part paid", paid: "Paid", void: "Void" };
const RECENT_PAYMENTS = 8;

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dateOnly = (value) => String(value || "").slice(0, 10);

function Tile({ label, value, tone = "default" }) {
  const toneClass = {
    default: "text-[var(--ink)]",
    danger: "text-[var(--danger)]",
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
  }[tone];
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--slate-quiet)]">{label}</p>
      <p className={`mt-1 break-words text-base font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--slate-quiet)]">{children}</h3>;
}

export default function StudentAccountModal({ studentId, currency, onClose, onManageParents, onChanged }) {
  const [student, setStudent] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  const [recordingInvoice, setRecordingInvoice] = useState(null);
  const [reminding, setReminding] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    Promise.all([
      apiRequest(`/students/${studentId}`),
      apiRequest(`/invoices?studentId=${studentId}`),
      apiRequest(`/payments?studentId=${studentId}`),
    ])
      .then(([s, inv, pay]) => {
        setStudent(s.data);
        setInvoices(inv.data);
        setPayments(pay.data);
      })
      .catch((err) => setError(err.message));
  }, [studentId, reloadKey]);

  function afterPayment() {
    setReloadKey((k) => k + 1);
    onChanged?.();
  }

  if (recordingInvoice) {
    return (
      <RecordPaymentModal
        invoice={recordingInvoice}
        currency={currency}
        onSaved={afterPayment}
        onClose={() => setRecordingInvoice(null)}
      />
    );
  }

  const primaryParent = student?.parents?.[0];
  const name = student ? `${student.first_name} ${student.last_name}` : "";

  if (reminding && primaryParent) {
    return (
      <SendReminderModal
        parentId={primaryParent.id}
        studentId={studentId}
        label={`${name} · to ${primaryParent.full_name}`}
        onClose={() => setReminding(false)}
      />
    );
  }

  const loading = !error && (!student || !invoices || !payments);
  const active = (invoices || []).filter((i) => i.status !== "void");
  const sum = (list, key) => list.reduce((total, row) => total + Number(row[key] || 0), 0);
  const billed = sum(active, "total");
  const paid = sum(active, "paid_amount");
  const owes = sum(active, "balance");
  const today = todayString();
  const outstanding = active
    .filter((i) => Number(i.balance) > 0)
    .sort((a, b) => dateOnly(a.due_date).localeCompare(dateOnly(b.due_date)));
  const overdue = sum(outstanding.filter((i) => dateOnly(i.due_date) < today), "balance");
  const shownPayments = showAllPayments ? payments || [] : (payments || []).slice(0, RECENT_PAYMENTS);

  return (
    <Modal
      size="lg"
      title={student ? name : "Student account"}
      description={
        student
          ? `${student.admission_no} · ${student.class_name}${primaryParent ? ` · ${primaryParent.full_name}${primaryParent.phone ? ` (${primaryParent.phone})` : ""}` : ""}`
          : undefined
      }
      onClose={onClose}
    >
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {loading && <LoadingSkeleton lines={4} />}

      {!loading && !error && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Billed" value={formatMoney(billed, currency)} />
            <Tile label="Paid" value={formatMoney(paid, currency)} tone="success" />
            <Tile label={owes > 0 ? "Owes" : "Balance"} value={owes > 0 ? formatMoney(owes, currency) : "Fully paid"} tone={owes > 0 ? "danger" : "success"} />
            <Tile label="Overdue" value={formatMoney(overdue, currency)} tone={overdue > 0 ? "warning" : "default"} />
          </div>

          <section>
            <SectionTitle>Outstanding</SectionTitle>
            {outstanding.length === 0 ? (
              <p className="rounded-lg bg-[var(--success-wash)] p-3 text-sm text-[var(--success)]">Nothing outstanding for this student.</p>
            ) : (
              <ul className="space-y-2">
                {outstanding.map((inv) => {
                  const isOverdue = dateOnly(inv.due_date) < today;
                  return (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--ink)]">{inv.fee_type_name}</p>
                        <p className="text-xs text-[var(--slate-quiet)]">
                          {inv.invoice_no} · Due {formatDate(inv.due_date)}
                          {isOverdue && <span className="ml-1.5"><StatusBadge tone="danger">Overdue</StatusBadge></span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-semibold text-[var(--danger)]">{formatMoney(inv.balance, currency)}</span>
                        <Button onClick={() => setRecordingInvoice(inv)} className="min-h-[40px]">Record payment</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle>Payment history</SectionTitle>
            {(payments || []).length === 0 ? (
              <p className="text-sm text-[var(--slate-quiet)]">No payments recorded yet.</p>
            ) : (
              <>
                <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                  {shownPayments.map((p) => {
                    const voided = p.status === "void";
                    return (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className={voided ? "text-[var(--slate-quiet)] line-through" : "text-[var(--ink)]"}>
                            {formatDate(p.paid_at || p.created_at)} · {METHOD_LABELS[p.method] || p.method}
                          </p>
                          <p className="text-xs text-[var(--slate-quiet)]">{p.invoice_no}{p.reference ? ` · Ref ${p.reference}` : ""}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {voided && <StatusBadge>Voided</StatusBadge>}
                          <span className={`font-semibold ${voided ? "text-[var(--slate-quiet)] line-through" : "text-[var(--success)]"}`}>
                            {formatMoney(p.amount, currency)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {(payments || []).length > RECENT_PAYMENTS && (
                  <LinkButton onClick={() => setShowAllPayments((v) => !v)} className="mt-2">
                    {showAllPayments ? "Show recent only" : `Show all ${payments.length} payments`}
                  </LinkButton>
                )}
              </>
            )}
          </section>

          <section>
            <button
              type="button"
              onClick={() => setShowAllInvoices((v) => !v)}
              className="flex w-full items-center justify-between text-left"
              aria-expanded={showAllInvoices}
            >
              <SectionTitle>All invoices ({(invoices || []).length})</SectionTitle>
              <span className="mb-2 text-xs font-medium text-[var(--primary)]">{showAllInvoices ? "Hide" : "Show"}</span>
            </button>
            {showAllInvoices && (
              (invoices || []).length === 0 ? (
                <p className="text-sm text-[var(--slate-quiet)]">No invoices yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                  {invoices.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="text-[var(--ink)]">{inv.fee_type_name}</p>
                        <p className="text-xs text-[var(--slate-quiet)]">{inv.invoice_no} · Due {formatDate(inv.due_date)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={statusTone(inv.status)}>{STATUS_LABELS[inv.status] || inv.status}</StatusBadge>
                        <span className="font-semibold text-[var(--ink)]">{formatMoney(inv.total, currency)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            )}
          </section>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-4">
            {!primaryParent && <p className="mr-auto text-xs text-[var(--slate-quiet)]">Link a parent to send reminders.</p>}
            <Button variant="secondary" onClick={() => onManageParents(student)}>Manage parents</Button>
            <Button onClick={() => setReminding(true)} disabled={!primaryParent || owes <= 0}>Send reminder</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
