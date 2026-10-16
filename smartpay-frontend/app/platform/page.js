"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Plus, Copy, Check } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Logo } from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import {
  Button, LinkButton, Field, inputClass, MetricCard, StatusBadge, EmptyState, ErrorState,
  LoadingSkeleton, MobileRecordCard, Modal, Toast, useToast,
} from "@/components/ui";

// The SmartPay owner console (2026-10-15). Schools only exist because the
// owner creates them here; each one's access depends on its status and
// paid-until date, which the backend enforces on every request.

const STATE_BADGES = {
  active: { tone: "success", label: "Active" },
  renewal: { tone: "warning", label: "Renewal due" },
  expired: { tone: "danger", label: "Expired" },
  suspended: { tone: "danger", label: "Suspended" },
};

function badgeFor(school) {
  if (school.state === "active" && school.renewalDue) return STATE_BADGES.renewal;
  return STATE_BADGES[school.state] || STATE_BADGES.active;
}

function slugify(name) {
  return String(name || "").toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 30).replace(/^-|-$/g, "");
}

const todayIso = () => new Date().toISOString().slice(0, 10);

// Extends from the later of today and the current end date, so renewing a
// little early never loses the days already paid for.
function extendDate(currentIso, months) {
  const base = currentIso && currentIso > todayIso() ? new Date(`${currentIso}T00:00:00Z`) : new Date(`${todayIso()}T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() + months);
  return base.toISOString().slice(0, 10);
}

function paidUntilText(school) {
  if (!school.paidUntil) return "No expiry";
  const date = formatDate(school.paidUntil);
  if (school.daysLeft < 0) return `${date} (ended)`;
  if (school.daysLeft === 0) return `${date} (today)`;
  return `${date} (${school.daysLeft} day${school.daysLeft === 1 ? "" : "s"} left)`;
}

function CopyBlock({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm text-[var(--ink)]">{text}</pre>
      <Button
        variant="secondary"
        className="mt-3 w-full gap-2"
        onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})}
      >
        {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy login details</>}
      </Button>
    </div>
  );
}

function loginDetails({ schoolName, adminEmail, tempPassword }) {
  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  return `SmartPay login for ${schoolName}\nLink: ${loginUrl}\nEmail: ${adminEmail}\nPassword: ${tempPassword}\n\nThis password works for 72 hours. You'll be asked to set your own the first time you log in.`;
}

function AddSchoolModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ schoolName: "", code: "", adminName: "", email: "", paidUntil: "" });
  const [codeEdited, setCodeEdited] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === "schoolName" && !codeEdited ? { code: slugify(value) } : {}) }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await apiRequest("/platform/schools", { method: "POST", body: { ...form, paidUntil: form.paidUntil || null } });
      setCreated({ schoolName: form.schoolName.trim(), adminEmail: res.data.adminEmail, tempPassword: res.data.tempPassword });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <Modal title="School created" description="Send these details to the school. The password is shown only once." onClose={onClose}>
        <CopyBlock text={loginDetails(created)} />
        <Button className="mt-3 w-full" onClick={onClose}>Done</Button>
      </Modal>
    );
  }

  return (
    <Modal title="Add a school" description="Creates the school and its admin login. Default fee types and an SMS template are added for them." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <ErrorState message={error} />}
        <Field label="School name">
          <input required maxLength={255} value={form.schoolName} onChange={set("schoolName")} className={inputClass} />
        </Field>
        <Field label="School code" hint="Lowercase letters, numbers and hyphens. Used internally; schools don't need to remember it.">
          <input required maxLength={30} value={form.code} onChange={(e) => { setCodeEdited(true); set("code")(e); }} className={inputClass} />
        </Field>
        <Field label="Admin's name">
          <input required maxLength={255} value={form.adminName} onChange={set("adminName")} className={inputClass} placeholder="e.g. the headteacher or bursar" />
        </Field>
        <Field label="Admin's email" hint="They log in with this email.">
          <input required type="email" maxLength={255} value={form.email} onChange={set("email")} className={inputClass} />
        </Field>
        <Field label="Paid until (optional)" hint="Leave empty for no expiry, e.g. during a free pilot.">
          <input type="date" min={todayIso()} value={form.paidUntil} onChange={set("paidUntil")} className={inputClass} />
        </Field>
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Creating..." : "Create school"}</Button>
      </form>
    </Modal>
  );
}

function ManageSchoolModal({ school, onClose, onChanged, showToast }) {
  const [paidUntil, setPaidUntil] = useState(school.paidUntil || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [newPassword, setNewPassword] = useState(null);

  async function update(body, message) {
    setError("");
    setBusy(true);
    try {
      await apiRequest(`/platform/schools/${school.id}`, { method: "PATCH", body });
      showToast(message);
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError("");
    setBusy(true);
    try {
      const res = await apiRequest(`/platform/schools/${school.id}/reset-admin-password`, { method: "POST" });
      setNewPassword({ schoolName: school.name, adminEmail: res.data.adminEmail, tempPassword: res.data.tempPassword });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (newPassword) {
    return (
      <Modal title="New password issued" description="Their old sessions are signed out. The password is shown only once." onClose={onClose}>
        <CopyBlock text={loginDetails(newPassword)} />
        <Button className="mt-3 w-full" onClick={onClose}>Done</Button>
      </Modal>
    );
  }

  const suspended = school.status === "suspended";

  return (
    <Modal title={school.name} description={`${school.adminName || "No admin"} · ${school.adminEmail || ""}`} onClose={onClose}>
      <div className="space-y-5">
        {error && <ErrorState message={error} />}

        <section>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Subscription</h3>
          <p className="mt-0.5 text-xs text-[var(--slate-quiet)]">Currently: {paidUntilText(school)}. After this date the school is blocked automatically.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPaidUntil(extendDate(school.paidUntil, 4))}>+1 term (4 months)</Button>
            <Button variant="secondary" onClick={() => setPaidUntil(extendDate(school.paidUntil, 12))}>+1 year</Button>
          </div>
          <Field label="Paid until" className="mt-3">
            <input type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} className={inputClass} />
          </Field>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button disabled={busy || paidUntil === (school.paidUntil || "")} onClick={() => update({ paidUntil: paidUntil || null }, "Subscription updated.")}>
              Save date
            </Button>
            {school.paidUntil && (
              <LinkButton disabled={busy} onClick={() => update({ paidUntil: null }, "Expiry removed.")}>Remove expiry</LinkButton>
            )}
          </div>
        </section>

        <section className="border-t border-[var(--border)] pt-4">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Access</h3>
          <p className="mt-0.5 text-xs text-[var(--slate-quiet)]">
            {suspended
              ? "Suspended: staff can't log in, reminders are off and payment links are unavailable. Their data is kept."
              : "Suspending blocks logins, stops reminders and disables payment links straight away. Data is kept, and reactivating restores everything."}
          </p>
          <Button
            variant={suspended ? "primary" : "danger"}
            className="mt-2"
            disabled={busy}
            onClick={() => update({ status: suspended ? "active" : "suspended" }, suspended ? "School reactivated." : "School suspended.")}
          >
            {suspended ? "Reactivate school" : "Suspend school"}
          </Button>
        </section>

        <section className="border-t border-[var(--border)] pt-4">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Admin password</h3>
          <p className="mt-0.5 text-xs text-[var(--slate-quiet)]">For an admin who is locked out. Issues a new one-time password and signs them out everywhere.</p>
          {confirmReset ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="danger" disabled={busy} onClick={resetPassword}>Yes, reset password</Button>
              <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="secondary" className="mt-2" onClick={() => setConfirmReset(true)}>Reset admin password</Button>
          )}
        </section>
      </div>
    </Modal>
  );
}

export default function PlatformConsolePage() {
  const router = useRouter();
  const [owner, setOwner] = useState(null);
  const [schools, setSchools] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(null);
  const { toast, showToast, dismissToast } = useToast();

  const loadSchools = useCallback(() => {
    return apiRequest("/platform/schools")
      .then((res) => setSchools(res.data))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    apiRequest("/platform/auth/me")
      .then((res) => {
        setOwner(res.data);
        return loadSchools();
      })
      .catch(() => router.replace("/platform/login"));
  }, [loadSchools, router]);

  async function logout() {
    await apiRequest("/platform/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/platform/login");
  }

  if (!owner) return <p className="p-8 text-sm text-[var(--slate-quiet)]">Loading...</p>;

  const list = schools || [];
  const counts = {
    total: list.length,
    active: list.filter((s) => s.state === "active").length,
    renewal: list.filter((s) => s.state === "active" && s.renewalDue).length,
    blocked: list.filter((s) => s.state !== "active").length,
    sms: list.reduce((sum, s) => sum + s.smsThisMonth, 0),
  };
  const current = managing ? list.find((s) => s.id === managing) : null;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 sm:px-6">
        <Logo size={28} />
        <span className="rounded-full bg-[var(--hover)] px-2 py-0.5 text-xs font-semibold text-[var(--slate)]">Console</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-[var(--slate-quiet)] sm:inline">{owner.name}</span>
          <ThemeToggle />
          <Button variant="secondary" className="gap-2" onClick={logout}><LogOut size={16} /> <span className="hidden sm:inline">Log out</span></Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--ink)]">Schools</h1>
            <p className="mt-1 text-sm text-[var(--slate-quiet)]">Every school on SmartPay. Only schools you add here can use it.</p>
          </div>
          <Button className="gap-2" onClick={() => setAdding(true)}><Plus size={16} /> Add school</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Active schools" value={schools ? counts.active : null} hint={`${counts.total} in total`} />
          <MetricCard label="Renewal due" value={schools ? counts.renewal : null} hint="Within 7 days" tone={counts.renewal ? "warning" : "default"} />
          <MetricCard label="Blocked" value={schools ? counts.blocked : null} hint="Suspended or expired" tone={counts.blocked ? "danger" : "default"} />
          <MetricCard label="SMS this month" value={schools ? counts.sms : null} hint="Sent across all schools" />
        </div>

        {error && <ErrorState message={error} />}
        {!schools && !error && <LoadingSkeleton lines={4} />}
        {schools && list.length === 0 && <EmptyState>No schools yet. Add your first school to get started.</EmptyState>}

        {list.length > 0 && (
          <>
            <div className="hidden overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)] md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--slate-quiet)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">School</th>
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 text-right font-medium">Students</th>
                    <th className="px-4 py-3 text-right font-medium">SMS (month)</th>
                    <th className="px-4 py-3 font-medium">Paid until</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {list.map((s) => {
                    const badge = badgeFor(s);
                    return (
                      <tr key={s.id} className="hover:bg-[var(--hover)]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[var(--ink)]">{s.name}</p>
                          <p className="text-xs text-[var(--slate-quiet)]">Joined {formatDate(s.createdAt)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[var(--ink)]">{s.adminName || "-"}</p>
                          <p className="text-xs text-[var(--slate-quiet)]">{s.adminEmail}</p>
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--ink)]">{s.studentCount}</td>
                        <td className="px-4 py-3 text-right text-[var(--ink)]">{s.smsThisMonth}</td>
                        <td className="px-4 py-3 text-[var(--slate)]">{paidUntilText(s)}</td>
                        <td className="px-4 py-3"><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></td>
                        <td className="px-4 py-3 text-right"><LinkButton onClick={() => setManaging(s.id)}>Manage</LinkButton></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 md:hidden">
              {list.map((s) => {
                const badge = badgeFor(s);
                return (
                  <MobileRecordCard key={s.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--ink)]">{s.name}</p>
                        <p className="truncate text-xs text-[var(--slate-quiet)]">{s.adminName} · {s.adminEmail}</p>
                      </div>
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm text-[var(--slate)]">{s.studentCount} students · {s.smsThisMonth} SMS this month</p>
                    <p className="text-sm text-[var(--slate)]">Paid until: {paidUntilText(s)}</p>
                    <Button variant="secondary" className="mt-3 w-full" onClick={() => setManaging(s.id)}>Manage</Button>
                  </MobileRecordCard>
                );
              })}
            </div>
          </>
        )}
      </main>

      {adding && <AddSchoolModal onClose={() => setAdding(false)} onCreated={loadSchools} />}
      {current && <ManageSchoolModal school={current} onClose={() => setManaging(null)} onChanged={loadSchools} showToast={showToast} />}
      <Toast {...toast} onDismiss={dismissToast} />
    </div>
  );
}
