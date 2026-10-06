"use client";

import { use, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";

// Paystack redirects the browser back here right after checkout — but the
// browser redirect alone is never proof of payment (the spec is explicit
// about this: only a verified webhook/server-side check counts). This page
// polls the real payment status rather than trusting the redirect itself,
// and keeps polling for a few seconds in case the webhook is still in
// flight ("redirect succeeds but webhook arrives later" is a known edge
// case, not a bug to paper over with a fake instant success message).
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 10;

export default function PaymentStatusPage({ params }) {
  const { reference } = use(params);
  const [status, setStatus] = useState(null);
  const [amount, setAmount] = useState(null);
  const [currency, setCurrency] = useState(null);
  const [error, setError] = useState("");
  const pollCount = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function poll() {
      try {
        const res = await apiRequest(`/public/payments/${reference}/status`);
        if (cancelled) return;
        setStatus(res.data.status);
        setAmount(res.data.amount);
        setCurrency(res.data.currency);

        pollCount.current += 1;
        if ((res.data.status === "initiated" || res.data.status === "pending") && pollCount.current < MAX_POLLS) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reference]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm rounded-xl border border-[var(--border)] bg-white p-6 text-center shadow-sm">
        {error && (
          <>
            <h1 className="text-lg font-semibold text-[var(--ink)]">We couldn&apos;t find this payment</h1>
            <p className="mt-1 text-sm text-[var(--slate-quiet)]">{error}</p>
          </>
        )}
        {!error && status === "success" && (
          <>
            <h1 className="text-lg font-semibold text-[var(--success)]">Payment successful</h1>
            <p className="mt-1 text-sm text-[var(--slate-quiet)]">{formatMoney(amount, currency)} received. Thank you.</p>
            <p className="mt-3 text-xs text-[var(--slate-quiet)]">Reference: <span className="font-mono">{reference}</span></p>
          </>
        )}
        {!error && (status === "initiated" || status === "pending") && (
          <>
            <h1 className="text-lg font-semibold text-[var(--ink)]">Confirming your payment...</h1>
            <p className="mt-1 text-sm text-[var(--slate-quiet)]">This usually takes a few seconds. Please don&apos;t close this page.</p>
          </>
        )}
        {!error && (status === "failed" || status === "cancelled") && (
          <>
            <h1 className="text-lg font-semibold text-[var(--danger)]">Payment not completed</h1>
            <p className="mt-1 text-sm text-[var(--slate-quiet)]">Your payment was not completed. You can go back and try again.</p>
            <button
              onClick={() => window.history.back()}
              className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary-bright)]"
            >
              Go Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
