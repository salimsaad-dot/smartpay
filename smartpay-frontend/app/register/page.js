"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

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

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-sm font-medium text-[var(--ink)]";

export default function RegisterSchoolPage() {
  const { registerSchool } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ schoolName: "", code: "", adminName: "", email: "", password: "" });
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function handleSchoolNameChange(value) {
    setForm((f) => ({ ...f, schoolName: value, code: codeTouched ? f.code : slugify(value) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Register your school</h1>
        <p className="mt-1 text-sm text-[var(--slate-quiet)]">Set up SmartPay for fee collection and arrears reminders.</p>

        {error && <div className="mt-4 rounded-lg bg-[var(--danger-wash)] px-3 py-2 text-sm text-[var(--danger)]">{error}</div>}

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <label htmlFor="schoolName" className={labelClass}>School Name</label>
            <input
              id="schoolName"
              required
              value={form.schoolName}
              onChange={(e) => handleSchoolNameChange(e.target.value)}
              className={inputClass}
              placeholder="e.g. Bright Future Academy"
            />
          </div>
          <div>
            <label htmlFor="code" className={labelClass}>School Code</label>
            <input
              id="code"
              required
              value={form.code}
              onChange={(e) => { setCodeTouched(true); setForm((f) => ({ ...f, code: e.target.value })); }}
              className={inputClass}
              placeholder="e.g. bright-future-academy"
            />
            <p className="mt-1 text-xs text-[var(--slate-quiet)]">Lowercase letters, numbers, and hyphens only. Used in future parent payment links.</p>
          </div>
          <div>
            <label htmlFor="adminName" className={labelClass}>Your Name</label>
            <input
              id="adminName"
              required
              value={form.adminName}
              onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="email" className={labelClass}>Email</label>
            <input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className={labelClass}>Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create School Account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--slate-quiet)]">
          Already have an account? <Link href="/login" className="font-medium text-[var(--primary)] hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}
