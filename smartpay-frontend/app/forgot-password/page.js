"use client";

import { useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { AuthSplitLayout } from "@/components/AuthSplitLayout";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [emailDeliveryConfigured, setEmailDeliveryConfigured] = useState(true);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      // Backend always returns the same generic message AND the same
      // emailDeliveryConfigured value regardless of whether the account
      // exists — deliberate, so this page can't be used to probe which
      // emails have real accounts by comparing responses.
      const res = await apiRequest("/auth/forgot-password", { method: "POST", body: { email } });
      setEmailDeliveryConfigured(res.emailDeliveryConfigured !== false);
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSplitLayout>
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="text-center text-2xl font-bold text-[var(--ink)]">Reset Your Password</h2>

        {submitted ? (
          <>
            {emailDeliveryConfigured ? (
              <p className="mt-4 text-center text-sm text-[var(--slate)]">
                If an account matches that email, a reset link has been sent to it. It expires in 30 minutes.
              </p>
            ) : (
              <div className="mt-4 rounded-lg bg-[var(--danger-wash)] px-3.5 py-3 text-sm text-[var(--danger)]">
                Email delivery isn&apos;t fully set up yet on this system, so a reset link most likely won&apos;t
                reach your inbox even if a matching account exists.
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-center text-sm text-[var(--slate-quiet)]">
              Enter your account email and we&apos;ll send you a reset link.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error && <div className="rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">Email Address</label>
                <input
                  id="email" type="email" required autoComplete="email" placeholder="admin@school.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60"
              >
                {submitting ? "Sending..." : "Send Reset Link"}
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-[var(--slate-quiet)]">
          <Link href="/login" className="font-medium text-[var(--primary)] hover:underline">Back to sign in</Link>
        </p>
      </div>
    </AuthSplitLayout>
  );
}
