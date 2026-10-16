"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, ArrowRight, Sparkles, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { AuthSplitLayout } from "@/components/AuthSplitLayout";
import { SMARTPAY_CONTACT, whatsappLink } from "@/lib/contact";

// Shown when a logged-in session was cut off because the school was
// suspended or its subscription ended (lib/api.js redirects here).
const BLOCKED_MESSAGES = {
  suspended: "Your school's SmartPay account is suspended. Please contact SmartPay to restore access.",
  expired: "Your school's SmartPay subscription has ended. Please contact SmartPay to renew.",
};

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const blockedReason = useSearchParams().get("blocked");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthSplitLayout>
      <div className="w-full max-w-sm rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="flex justify-center lg:hidden">
          <Logo size={36} />
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold text-[var(--ink)] lg:mt-0">Welcome Back</h2>
        <p className="mt-1 text-center text-sm text-[var(--slate-quiet)]">Sign in to your school account to continue</p>

        {(error || BLOCKED_MESSAGES[blockedReason]) && (
          <div className="mt-4 rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">
            {error || BLOCKED_MESSAGES[blockedReason]}
            {/suspended|subscription has ended|one-time password has expired/.test(error || BLOCKED_MESSAGES[blockedReason]) && (
              <a href={whatsappLink("Hello, I'm contacting you about our school's SmartPay account.")} target="_blank" rel="noopener noreferrer" className="mt-1 block font-semibold underline">
                WhatsApp SmartPay ({SMARTPAY_CONTACT.phoneDisplay})
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">Email Address</label>
            <input
              id="email" type="email" required autoComplete="email" placeholder="admin@school.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">Password</label>
              <Link href="/forgot-password" className="mb-1.5 text-sm font-medium text-[var(--primary)] hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="password" type={showPassword ? "text" : "password"} required autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2.5 pr-10 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center text-[var(--slate-quiet)] hover:text-[var(--slate)]"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--slate)]">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded border-[var(--border)]" />
            Remember me
          </label>
          <button
            type="submit"
            disabled={saving}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60"
          >
            {saving ? "Logging in..." : <>Log In <ArrowRight size={16} /></>}
          </button>
        </form>

        <div className="mt-6 border-t border-[var(--border)] pt-5 text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm text-[var(--slate-quiet)]">
            <Sparkles size={14} /> Want SmartPay for your school?{" "}
            <a href={`${SMARTPAY_CONTACT.marketingUrl}/#contact`} className="font-medium text-[var(--primary)] hover:underline">Talk to us</a>
          </p>
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-[var(--slate-quiet)]">
          <ShieldCheck size={13} /> Your data is secure and protected
        </p>
      </div>
    </AuthSplitLayout>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
