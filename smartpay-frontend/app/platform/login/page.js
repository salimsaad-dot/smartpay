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
// school login.
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/platform/auth/login", { method: "POST", body: { email, password } });
      router.push("/platform");
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex justify-center"><Logo size={34} /></div>
        <h1 className="mt-5 text-center text-xl font-semibold text-[var(--ink)]">SmartPay console</h1>
        <p className="mt-1 text-center text-sm text-[var(--slate-quiet)]">For the SmartPay owner. Schools log in at the normal login page.</p>

        {error && <p role="alert" className="mt-4 rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <Field label="Email">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Password">
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          <Button type="submit" disabled={saving} className="w-full">{saving ? "Logging in..." : "Log in"}</Button>
        </form>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-[var(--slate-quiet)]"><ShieldCheck size={13} /> Locks for 15 minutes after 5 wrong passwords</p>
      </div>
    </main>
  );
}
