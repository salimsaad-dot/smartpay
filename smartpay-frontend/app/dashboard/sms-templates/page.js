"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
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
