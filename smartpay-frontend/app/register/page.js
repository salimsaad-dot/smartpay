"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";
import { AuthSplitLayout } from "@/components/AuthSplitLayout";

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30)
    .replace(/-$/, "");
}

const inputClass = "w-full rounded-lg border border-[var(--border)] px-3 py-2.5 text-base focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ink)]";

export default function RegisterSchoolPage() {
  const { registerSchool } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ schoolName: "", code: "", adminName: "", email: "", password: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function handleSchoolNameChange(value) {
    setForm((f) => ({ ...f, schoolName: value, code: codeTouched ? f.code : slugify(value) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      await registerSchool(form);
      router.push("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthSplitLayout>
      <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="flex justify-center lg:hidden">
          <Logo size={36} />
        </div>
        <h2 className="mt-6 text-center text-2xl font-bold text-[var(--ink)] lg:mt-0">Register your school</h2>
        <p className="mt-1 text-center text-sm text-[var(--slate-quiet)]">Set up SmartPay for fee collection and arrears reminders</p>

        {error && <div className="mt-4 rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="schoolName" className={labelClass}>School Name</label>
            <input
              id="schoolName" required value={form.schoolName}
              onChange={(e) => handleSchoolNameChange(e.target.value)}
              className={inputClass} placeholder="e.g. Bright Future Academy"
            />
          </div>
          <div>
            <label htmlFor="code" className={labelClass}>School Code</label>
            <input
              id="code" required value={form.code}
              onChange={(e) => { setCodeTouched(true); setForm((f) => ({ ...f, code: e.target.value })); }}
              className={inputClass} placeholder="e.g. bright-future-academy"
            />
            <p className="mt-1 text-xs text-[var(--slate-quiet)]">Lowercase letters, numbers, and hyphens only. Used in future parent payment links.</p>
          </div>
          <div>
            <label htmlFor="adminName" className={labelClass}>Your Name</label>
            <input id="adminName" required value={form.adminName} onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor="email" className={labelClass}>Email</label>
            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputClass} />
          </div>
          <div>
            <label htmlFor="password" className={labelClass}>Password</label>
            <div className="relative">
              <input
                id="password" type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password"
                value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className={`${inputClass} pr-10`}
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
          <div>
            <label htmlFor="confirmPassword" className={labelClass}>Confirm Password</label>
            <div className="relative">
              <input
                id="confirmPassword" type={showConfirmPassword ? "text" : "password"} required minLength={8} autoComplete="new-password"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                className={`${inputClass} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((s) => !s)}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center text-[var(--slate-quiet)] hover:text-[var(--slate)]"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60"
          >
            {saving ? "Creating..." : <>Create School Account <ArrowRight size={16} /></>}
          </button>
        </form>

        <div className="mt-6 border-t border-[var(--border)] pt-5 text-center">
          <p className="text-sm text-[var(--slate-quiet)]">
            Already have an account? <Link href="/login" className="font-medium text-[var(--primary)] hover:underline">Log in</Link>
          </p>
        </div>
      </div>
    </AuthSplitLayout>
  );
}
