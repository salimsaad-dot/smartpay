"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { AuthSplitLayout } from "@/components/AuthSplitLayout";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("/auth/reset-password", { method: "POST", body: { token, newPassword } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <>
        <h2 className="text-center text-2xl font-bold text-[var(--ink)]">Invalid Link</h2>
        <p className="mt-2 text-center text-sm text-[var(--slate)]">
          This reset link is missing its token. Request a new one from the login page.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-semibold text-white hover:bg-[var(--primary-bright)]"
        >
          Request a new reset link
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <h2 className="text-center text-2xl font-bold text-[var(--ink)]">Password Reset</h2>
        <p className="mt-2 text-center text-sm text-[var(--slate)]">
          You can now sign in with your new password. Any other signed-in devices have been logged out.
        </p>
        <Link
          href="/login"
          className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-semibold text-white hover:bg-[var(--primary-bright)]"
        >
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h2 className="text-center text-2xl font-bold text-[var(--ink)]">Set a New Password</h2>
      <p className="mt-1 text-center text-sm text-[var(--slate-quiet)]">At least 8 characters.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && <div className="rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}
        <div>
          <label htmlFor="newPassword" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">New Password</label>
          <input
            id="newPassword" type="password" required minLength={8} autoComplete="new-password"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">Confirm New Password</label>
          <input
            id="confirm" type="password" required minLength={8} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60"
        >
          {submitting ? "Resetting..." : "Reset Password"}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthSplitLayout>
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </AuthSplitLayout>
  );
}
