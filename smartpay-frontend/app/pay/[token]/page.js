"use client";

import { use, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";

export default function PublicCheckoutPage({ params }) {
  const { token } = use(params);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    apiRequest(`/public/checkout/${token}`)
      .then((res) => {
        setData(res.data);
        setEmail(res.data.parentEmail || "");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  function pickInvoice(invoice) {
    setSelectedInvoice(invoice);
    setAmount(String(invoice.balance));
    setSubmitError("");
  }

  async function handlePay(e) {
    e.preventDefault();
    setSubmitError("");
    if (!email.trim()) {
      setSubmitError("Please enter an email to proceed with payment.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("/public/payments/initialize", {
        method: "POST",
        body: { token, invoiceId: selectedInvoice.id, amount: Number(amount), email: email.trim() },
      });
      window.location.href = res.data.authorizationUrl;
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return <CenteredMessage>Loading...</CenteredMessage>;
  }

  if (error) {
    return <CenteredMessage title="This payment link isn't available">{error}</CenteredMessage>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-8">
      <div className="rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-[var(--ink)]">{data.schoolName}</h1>
        <p className="mt-1 text-sm text-[var(--slate-quiet)]">Dear {data.parentName}, here are your children&apos;s outstanding balances.</p>

        {data.children.length === 0 ? (
          <p className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-[var(--success)]">
            Great news — there are no outstanding balances right now.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {data.children.map((child) => (
              <div key={child.studentId} className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-sm font-semibold text-[var(--ink)]">{child.name} · {child.className}</p>
                <div className="mt-2 space-y-2">
                  {child.invoices.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => pickInvoice(inv)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                        selectedInvoice?.id === inv.id
                          ? "border-[var(--primary)] bg-blue-50"
                          : "border-[var(--border)] hover:bg-gray-50"
                      }`}
                    >
                      <span>
                        <span className="block font-medium text-[var(--ink)]">{inv.termName}</span>
                        <span className="block text-xs text-[var(--slate-quiet)]">{inv.invoiceNo} · Due {formatDate(inv.dueDate)}</span>
                      </span>
                      <span className="font-semibold text-[var(--ink)]">{formatMoney(inv.balance, data.currency)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedInvoice && (
          <form onSubmit={handlePay} className="mt-5 space-y-3 border-t border-[var(--border)] pt-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--slate-quiet)]">Amount to pay</label>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                max={selectedInvoice.balance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
              <p className="mt-1 text-xs text-[var(--slate-quiet)]">Outstanding balance: {formatMoney(selectedInvoice.balance, data.currency)}. You may pay part of this amount.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--slate-quiet)]">Email (for your payment receipt)</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </div>
            {submitError && <p className="text-sm text-[var(--danger)]">{submitError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60"
            >
              {submitting ? "Redirecting to secure payment..." : `Pay ${formatMoney(amount || 0, data.currency)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function CenteredMessage({ title, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-6 text-center shadow-sm">
        {title && <h1 className="text-lg font-semibold text-[var(--ink)]">{title}</h1>}
        <p className="mt-1 text-sm text-[var(--slate-quiet)]">{children}</p>
      </div>
    </div>
  );
}
