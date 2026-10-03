"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

const VARIABLES = ["school_name", "parent_name", "student_name", "student_count", "term_name", "total_balance", "payment_link", "due_date"];

function TemplateForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [body, setBody] = useState(initial?.body || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-[var(--border)] bg-white p-4">
      <div>
        <label className={labelClass}>Template Name</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Message</label>
        <textarea required rows={4} value={body} onChange={(e) => setBody(e.target.value)} className={inputClass} />
        <p className="mt-1 text-xs text-[var(--slate-quiet)]">
          Available variables: {VARIABLES.map((v) => `{{${v}}}`).join(", ")}
        </p>
      </div>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          {saving ? "Saving..." : "Save Template"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--slate-quiet)] hover:bg-gray-50">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function FridayAutomationPanel({ templates }) {
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

  if (!settings) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4">
      <h2 className="font-semibold text-[var(--ink)]">Friday Automation</h2>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Automatically reminds every parent with an outstanding balance, once a week.</p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input
            type="checkbox"
            checked={!!settings.friday_reminders_enabled}
            onChange={(e) => save({ fridayRemindersEnabled: e.target.checked })}
          />
          Enabled
        </label>
        <div>
          <label className={labelClass}>Template</label>
          <select
            value={settings.friday_template_id || ""}
            onChange={(e) => save({ fridayTemplateId: e.target.value ? Number(e.target.value) : null })}
            className={inputClass}
          >
            <option value="">Default (first active template)</option>
            {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Min Balance (optional)</label>
          <input
            type="number" min="0" defaultValue={settings.reminder_min_balance ?? ""}
            onBlur={(e) => save({ reminderMinBalance: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Cooldown (days, optional)</label>
          <input
            type="number" min="0" defaultValue={settings.reminder_cooldown_days ?? ""}
            onBlur={(e) => save({ reminderCooldownDays: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      {saving && <p className="mt-2 text-xs text-[var(--slate-quiet)]">Saving...</p>}
      {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <button onClick={runNow} disabled={running} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          {running ? "Running..." : "Run Now"}
        </button>
        <span className="ml-2 text-xs text-[var(--slate-quiet)]">Manually triggers this week's cycle now — useful for testing.</span>
        {runResult && (
          <p className="mt-2 text-sm text-[var(--slate)]">
            Processed {runResult.processed}, sent {runResult.success}, failed {runResult.failure}.
          </p>
        )}
      </div>

      {jobs && jobs.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-gray-50 text-[var(--slate-quiet)]">
                <th className="p-2">Cycle</th><th className="p-2">Status</th><th className="p-2">Started</th>
                <th className="p-2">Processed</th><th className="p-2">Sent</th><th className="p-2">Failed</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-2 font-mono">{j.cycle_key}</td>
                  <td className="p-2">{j.status}</td>
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
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  function load() {
    apiRequest("/sms-templates").then((res) => setTemplates(res.data));
  }
  useEffect(load, []);

  async function toggleStatus(t) {
    await apiRequest(`/sms-templates/${t.id}`, { method: "PATCH", body: { name: t.name, body: t.body, status: t.status === "active" ? "inactive" : "active" } });
    load();
  }

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">SMS Templates</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Used for manual fee reminders. A default template is ready to use from day one.</p>

      <div className="mt-4"><FridayAutomationPanel templates={templates} /></div>

      <div className="mt-4">
        {!showNewForm ? (
          <button onClick={() => setShowNewForm(true)} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)]">
            New Template
          </button>
        ) : (
          <TemplateForm onSave={() => { setShowNewForm(false); load(); }} onCancel={() => setShowNewForm(false)} />
        )}
      </div>

      {templates && (
        <div className="mt-4 space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--border)] bg-white p-4">
              {editingId === t.id ? (
                <TemplateForm initial={t} onSave={() => { setEditingId(null); load(); }} onCancel={() => setEditingId(null)} />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-[var(--ink)]">{t.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.status === "active" ? "bg-green-50 text-[var(--success)]" : "bg-gray-100 text-[var(--slate-quiet)]"}`}>
                        {t.status === "active" ? "Active" : "Inactive"}
                      </span>
                      <button onClick={() => setEditingId(t.id)} className="text-xs font-medium text-[var(--primary)] hover:underline">Edit</button>
                      <button onClick={() => toggleStatus(t)} className="text-xs font-medium text-[var(--slate-quiet)] hover:underline">
                        {t.status === "active" ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--slate)]">{t.body}</p>
                </>
              )}
            </div>
          ))}
          {templates.length === 0 && <p className="text-sm text-[var(--slate-quiet)]">No templates yet.</p>}
        </div>
      )}
    </DashboardShell>
  );
}
