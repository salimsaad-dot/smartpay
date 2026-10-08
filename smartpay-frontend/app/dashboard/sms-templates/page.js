"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Bell, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingSkeleton,
  PageHeader,
  StatusBadge,
  Toast,
  inputClass,
  labelClass,
  statusTone,
  useToast,
} from "@/components/ui";

const VARIABLES = ["school_name", "parent_name", "student_name", "student_count", "term_name", "total_balance", "payment_link", "due_date", "school_momo_number"];

// Same "this school's own number, this calendar month" view already on
// the Dashboard — added here too since a user naturally checks the page
// where sending actually happens, not just the overview. No new backend
// endpoint: reportsController.smsActivity already accepts startDate.
function UsageSummaryPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    apiRequest(`/reports/sms-activity?startDate=${startOfMonth}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return null; // non-critical — the page still works without this panel
  if (!data) return <LoadingSkeleton lines={1} />;

  // `summary.sent` from the backend is actually "sent OR delivered"
  // combined — same derivation the Dashboard card already uses to split
  // it back into "still just sent" vs. "confirmed delivered", kept in
  // sync rather than inventing a different computation here.
  const delivered = data.reminders.filter((r) => r.status === "delivered").length;
  const sentOnly = data.summary.sent - delivered;

  // Literal class strings throughout (not built from a template-literal
  // tone variable) — Tailwind's build-time scanner can't see a
  // dynamically-interpolated class name like `bg-[var(--${tone}-wash)]`,
  // so that pattern silently produces unstyled boxes in production even
  // though it looks fine in dev. Matches the Dashboard card's own
  // literal JSX for the identical three stats, deliberately kept in sync.
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-[var(--ink)]">SMS Usage This Month</h2>
        <Link href="/dashboard/reports" className="text-xs font-medium text-[var(--primary)] hover:underline">Other periods</Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-[var(--success-wash)] p-3 text-center">
          <CheckCircle2 size={16} className="mx-auto text-[var(--success)]" />
          <p className="mt-1 text-lg font-bold text-[var(--ink)]">{sentOnly}</p>
          <p className="text-[11px] text-[var(--slate-quiet)]">Sent</p>
        </div>
        <div className="rounded-lg bg-[var(--primary-wash)] p-3 text-center">
          <Bell size={16} className="mx-auto text-[var(--primary)]" />
          <p className="mt-1 text-lg font-bold text-[var(--ink)]">{delivered}</p>
          <p className="text-[11px] text-[var(--slate-quiet)]">Delivered</p>
        </div>
        <div className="rounded-lg bg-[var(--danger-wash)] p-3 text-center">
          <XCircle size={16} className="mx-auto text-[var(--danger)]" />
          <p className="mt-1 text-lg font-bold text-[var(--ink)]">{data.summary.failed}</p>
          <p className="text-[11px] text-[var(--slate-quiet)]">Failed</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-[var(--slate-quiet)]">This is your school&apos;s own SMS count for the current calendar month.</p>
    </div>
  );
}

// For parents with no smartphone/data, the payment link alone is a dead
// end — this gives every reminder a second, phone-agnostic way to pay
// (send directly to the school's own MoMo number via USSD), without
// needing to guess which parents can or can't use the online link.
function MomoNumberPanel({ showToast }) {
  const [momoNumber, setMomoNumber] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest("/settings/profile").then((res) => setMomoNumber(res.data.momo_number || ""));
  }, []);

  async function handleBlur(e) {
    const value = e.target.value;
    setError("");
    setSaving(true);
    try {
      await apiRequest("/settings/profile", { method: "PATCH", body: { momoNumber: value } });
      showToast("Payment number saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (momoNumber === null) return <LoadingSkeleton lines={1} />;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <h2 className="font-semibold text-[var(--ink)]">Direct Payment Number</h2>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">
        For parents without a smartphone — add this as <code className="rounded bg-[var(--hover)] px-1 py-0.5 text-xs">{"{{school_momo_number}}"}</code> in
        a template so every reminder also offers a direct MoMo option, not just the online payment link.
      </p>
      <div className="mt-3 max-w-xs">
        <Field label="Mobile Money Number">
          <input
            type="tel"
            defaultValue={momoNumber}
            onBlur={handleBlur}
            placeholder="e.g. 024 123 4567"
            className={inputClass}
          />
        </Field>
      </div>
      {saving && <p className="mt-2 text-xs text-[var(--slate-quiet)]">Saving...</p>}
      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}

function TemplateForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [body, setBody] = useState(initial?.body || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const messageId = useId();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (initial) {
        await apiRequest(`/sms-templates/${initial.id}`, { method: "PATCH", body: { name, body, status: initial.status } });
      } else {
        await apiRequest("/sms-templates", { method: "POST", body: { name, body } });
      }
      onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <Field label="Template Name">
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <div>
        <label htmlFor={messageId} className={labelClass}>Message</label>
        <textarea id={messageId} required rows={4} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <code key={v} className="rounded bg-[var(--hover)] px-1.5 py-0.5 text-xs text-[var(--slate)]">{`{{${v}}}`}</code>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Template"}</Button>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

function FridayAutomationPanel({ templates, showToast }) {
  const [settings, setSettings] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [error, setError] = useState("");

  function load() {
    apiRequest("/settings/friday-reminders").then((res) => setSettings(res.data));
    apiRequest("/scheduled-jobs").then((res) => setJobs(res.data));
  }
  useEffect(load, []);

  async function save(partial) {
    setSaving(true);
    setError("");
    try {
      await apiRequest("/settings/friday-reminders", { method: "PATCH", body: partial });
      load();
      showToast("Friday automation settings saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setRunResult(null);
    setError("");
    try {
      const res = await apiRequest("/scheduled-jobs/friday/run", { method: "POST" });
      setRunResult(res.data);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  if (!settings) return <LoadingSkeleton lines={3} />;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <h2 className="font-semibold text-[var(--ink)]">Friday Automation</h2>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Automatically reminds every parent with an outstanding balance, once a week.</p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--ink)] sm:min-h-0">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={!!settings.friday_reminders_enabled}
            onChange={(e) => save({ fridayRemindersEnabled: e.target.checked })}
          />
          Enabled
        </label>
        <Field label="Template">
          <select
            value={settings.friday_template_id || ""}
            onChange={(e) => save({ fridayTemplateId: e.target.value ? Number(e.target.value) : null })}
            className={inputClass}
          >
            <option value="">Default (first active template)</option>
            {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Min Balance (optional)">
          <input
            type="number" min="0" defaultValue={settings.reminder_min_balance ?? ""}
            onBlur={(e) => save({ reminderMinBalance: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Cooldown (days, optional)">
          <input
            type="number" min="0" defaultValue={settings.reminder_cooldown_days ?? ""}
            onBlur={(e) => save({ reminderCooldownDays: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      {saving && <p className="mt-2 text-xs text-[var(--slate-quiet)]">Saving...</p>}
      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}

      <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center">
        <Button onClick={runNow} disabled={running}>{running ? "Running..." : "Run Now"}</Button>
        <span className="text-xs text-[var(--slate-quiet)]">Manually triggers this week's cycle now — useful for testing.</span>
      </div>
      {runResult && (
        <p className="mt-2 text-sm text-[var(--slate)]">
          Processed {runResult.processed}, sent {runResult.success}, failed {runResult.failure}.
        </p>
      )}

      {jobs && jobs.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[var(--slate-quiet)]">
                <th className="p-2 font-medium">Cycle</th><th className="p-2 font-medium">Status</th><th className="p-2 font-medium">Started</th>
                <th className="p-2 font-medium">Processed</th><th className="p-2 font-medium">Sent</th><th className="p-2 font-medium">Failed</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-2 font-mono">{j.cycle_key}</td>
                  <td className="p-2"><StatusBadge tone={statusTone(j.status)}>{j.status}</StatusBadge></td>
                  <td className="p-2">{formatDate(j.started_at)}</td>
                  <td className="p-2">{j.processed_count}</td>
                  <td className="p-2">{j.success_count}</td>
                  <td className="p-2">{j.failure_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SmsTemplatesPage() {
  const [templates, setTemplates] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/sms-templates")
      .then((res) => setTemplates(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function toggleStatus(t) {
    await apiRequest(`/sms-templates/${t.id}`, { method: "PATCH", body: { name: t.name, body: t.body, status: t.status === "active" ? "inactive" : "active" } });
    load();
    showToast(t.status === "active" ? "Template deactivated." : "Template activated.");
  }

  return (
    <DashboardShell>
      <PageHeader title="SMS Templates" description="Used for manual fee reminders. A default template is ready to use from day one." />

      <div className="mt-4"><UsageSummaryPanel /></div>
      <div className="mt-4"><MomoNumberPanel showToast={showToast} /></div>
      <div className="mt-4"><FridayAutomationPanel templates={templates} showToast={showToast} /></div>

      <div className="mt-4">
        {!showNewForm ? (
          <Button onClick={() => setShowNewForm(true)}>New Template</Button>
        ) : (
          <TemplateForm
            onSave={() => { setShowNewForm(false); load(); showToast("Template created."); }}
            onCancel={() => setShowNewForm(false)}
          />
        )}
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!templates && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {templates && (
        <div className="mt-4 space-y-3">
          {templates.length === 0 && <EmptyState>No templates yet.</EmptyState>}
          {templates.map((t) => (
            <div key={t.id} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
              {editingId === t.id ? (
                <TemplateForm
                  initial={t}
                  onSave={() => { setEditingId(null); load(); showToast("Template updated."); }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-[var(--ink)]">{t.name}</h3>
                    <div className="flex items-center gap-3">
                      <StatusBadge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Active" : "Inactive"}</StatusBadge>
                      <LinkButton onClick={() => setEditingId(t.id)}>Edit</LinkButton>
                      <LinkButton className="text-[var(--slate-quiet)]" onClick={() => toggleStatus(t)}>
                        {t.status === "active" ? "Deactivate" : "Activate"}
                      </LinkButton>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--slate)]">{t.body}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
