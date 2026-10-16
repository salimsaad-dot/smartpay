"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { Button, Field, inputClass } from "@/components/ui";

// The SmartPay owner's console login. Not linked from anywhere a school
// sees: the owner opens /platform/login directly. Uses its own cookie and
// account table (backend: routes/platformRoutes.js), separate from every
// school login. Two steps: password, then the 6-digit code from the
// owner's authenticator app (set up with scripts/setup-console-2fa.js).
export default function PlatformLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handlePassword(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/platform/auth/login", { method: "POST", body: { email, password } });
      setPassword("");
      setStep("code");
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function handleCode(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/platform/auth/verify-code", { method: "POST", body: { code } });
      router.push("/platform");
    } catch (err) {
      setError(err.message);
      setCode("");
      setSaving(false);
    }
  }

  function startOver() {
    setStep("password");
    setCode("");
    setError("");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex justify-center"><Logo size={34} /></div>
        <h1 className="mt-5 text-center text-xl font-semibold text-[var(--ink)]">SmartPay console</h1>
        <p className="mt-1 text-center text-sm text-[var(--slate-quiet)]">
          {step === "password"
            ? "For the SmartPay owner. Schools log in at the normal login page."
            : "Enter the 6-digit code from your authenticator app."}
        </p>

        {error && <p role="alert" className="mt-4 rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

        {step === "password" ? (
          <form onSubmit={handlePassword} className="mt-5 space-y-4">
            <Field label="Email">
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Password">
              <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </Field>
            <Button type="submit" disabled={saving} className="w-full">{saving ? "Checking..." : "Continue"}</Button>
          </form>
        ) : (
          <form onSubmit={handleCode} className="mt-5 space-y-4">
            <Field label="Code">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${inputClass} text-center text-lg tracking-[0.4em]`}
              />
            </Field>
            <Button type="submit" disabled={saving || code.length !== 6} className="w-full">{saving ? "Logging in..." : "Log in"}</Button>
            <button type="button" onClick={startOver} className="w-full text-center text-sm text-[var(--slate)] underline-offset-2 hover:underline">
              Use a different account
            </button>
          </form>
        )}
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-[var(--slate-quiet)]"><ShieldCheck size={13} /> Password and authenticator code, both required</p>
      </div>
    </main>
  );
}
