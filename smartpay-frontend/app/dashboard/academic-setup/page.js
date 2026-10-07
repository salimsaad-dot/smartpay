"use client";

import { useEffect, useState } from "react";
import { Plus, ClipboardList, Bell } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingSkeleton,
  Modal,
  MobileRecordCard,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";
import { Badge2, Button2, Card2 } from "@/components/ui2";

const TABS = [
  { key: "years", label: "Academic Year" },
  { key: "terms", label: "Terms" },
  { key: "reminders", label: "Reminder Settings" },
];

// Derived, not stored — the schema only has `is_current` plus the
// period's own start/end dates, so "Completed" vs "Upcoming" is computed
// from today's date rather than a separate status column.
function periodStatus(p) {
  if (p.is_current) return { label: "Current", tone: "success" };
  if (new Date(p.end_date) < new Date()) return { label: "Completed", tone: "neutral" };
  return { label: "Upcoming", tone: "info" };
}

function AddYearModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/academic-years", { method: "POST", body: form });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Academic Year" description="e.g. 2026/2027" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Year Name"><input required placeholder="e.g. 2026/2027" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} /></Field>
        <Field label="Start Date"><input required type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} /></Field>
        <Field label="End Date"><input required type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} /></Field>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button2 variant="secondary" type="button" onClick={onClose}>Cancel</Button2>
          <Button2 type="submit" disabled={saving}>{saving ? "Adding..." : "Add Year"}</Button2>
        </div>
      </form>
    </Modal>
  );
}

function AddTermModal({ years, onClose, onCreated }) {
  const [form, setForm] = useState({ academicYearId: "", name: "", startDate: "", endDate: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/terms", { method: "POST", body: { ...form, academicYearId: Number(form.academicYearId) } });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Term" description="e.g. Term 1" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Academic Year">
          <select required value={form.academicYearId} onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))} className={inputClass}>
            <option value="">Select...</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </Field>
        <Field label="Term Name"><input required placeholder="e.g. Term 1" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} /></Field>
        <Field label="Start Date"><input required type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} /></Field>
        <Field label="End Date"><input required type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} /></Field>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button2 variant="secondary" type="button" onClick={onClose}>Cancel</Button2>
          <Button2 type="submit" disabled={saving}>{saving ? "Adding..." : "Add Term"}</Button2>
        </div>
      </form>
    </Modal>
  );
}

// Shared table/card shape for both Academic Years and Terms.
function PeriodList({ items, onSetCurrent }) {
  if (!items) return <LoadingSkeleton lines={2} />;

  return (
    <>
      <div className="mt-4 space-y-2 lg:hidden">
        {items.length === 0 && <EmptyState>Nothing here yet.</EmptyState>}
        {items.map((item) => {
          const st = periodStatus(item);
          return (
            <MobileRecordCard key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">{item.name}</p>
                  <p className="text-xs text-[var(--slate-quiet)]">{formatDate(item.start_date)} – {formatDate(item.end_date)}</p>
                </div>
                <Badge2 tone={st.tone}>{st.label}</Badge2>
              </div>
              {!item.is_current && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <LinkButton onClick={() => onSetCurrent(item.id)}>Set Current</LinkButton>
                </div>
              )}
            </MobileRecordCard>
          );
        })}
      </div>

      <Card2 className="mt-4 hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3 font-medium">Year</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Start Date</th><th className="p-3 font-medium">End Date</th><th className="p-3 font-medium">Actions</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const st = periodStatus(item);
              return (
                <tr key={item.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]">
                  <td className="p-3 font-medium text-[var(--ink)]">{item.name}</td>
                  <td className="p-3"><Badge2 tone={st.tone}>{st.label}</Badge2></td>
                  <td className="p-3">{formatDate(item.start_date)}</td>
                  <td className="p-3">{formatDate(item.end_date)}</td>
                  <td className="p-3">{!item.is_current && <LinkButton onClick={() => onSetCurrent(item.id)}>Set Current</LinkButton>}</td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </Card2>
    </>
  );
}

function YearsTab({ years, onSetCurrent, onAdd, onNavTab }) {
  const current = years?.find((y) => y.is_current);
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-4">
      <div className="xl:col-span-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[var(--ink)]">Academic Years</h2>
            <p className="text-xs text-[var(--slate-quiet)]">Set up and manage your academic years.</p>
          </div>
          <Button2 onClick={onAdd}><Plus size={16} /> Add Academic Year</Button2>
        </div>
        <PeriodList items={years} onSetCurrent={onSetCurrent} />
      </div>

      <div className="space-y-6">
        <Card2 className="p-5">
          <h2 className="font-semibold text-[var(--ink)]">Current Academic Year Details</h2>
          {years === null ? (
            <LoadingSkeleton lines={2} />
          ) : current ? (
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex items-center justify-between"><dt className="text-[var(--slate-quiet)]">Academic Year</dt><dd className="font-medium text-[var(--ink)]">{current.name}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-[var(--slate-quiet)]">Start Date</dt><dd className="font-medium text-[var(--ink)]">{formatDate(current.start_date)}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-[var(--slate-quiet)]">End Date</dt><dd className="font-medium text-[var(--ink)]">{formatDate(current.end_date)}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-[var(--slate-quiet)]">Status</dt><dd><Badge2 tone="success">Active</Badge2></dd></div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-[var(--slate-quiet)]">No academic year is set as current yet.</p>
          )}
        </Card2>

        <Card2 className="p-5">
          <h2 className="font-semibold text-[var(--ink)]">Quick Actions</h2>
          <div className="mt-3 space-y-2">
            <button onClick={() => onNavTab("terms")} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-left text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)]">
              <ClipboardList size={18} />
              <span>
                <span className="block">Manage Terms</span>
                <span className="block text-xs font-normal text-[var(--slate-quiet)]">Add, edit or review terms</span>
              </span>
            </button>
            <button onClick={() => onNavTab("reminders")} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-left text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)]">
              <Bell size={18} />
              <span>
                <span className="block">Reminder Settings</span>
                <span className="block text-xs font-normal text-[var(--slate-quiet)]">Configure Friday SMS reminders</span>
              </span>
            </button>
          </div>
        </Card2>
      </div>
    </div>
  );
}

function TermsTab({ terms, onSetCurrent, onAdd }) {
  return (
    <div className="mt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[var(--ink)]">Terms</h2>
          <p className="text-xs text-[var(--slate-quiet)]">Set up and manage terms within each academic year.</p>
        </div>
        <Button2 onClick={onAdd}><Plus size={16} /> Add Term</Button2>
      </div>
      <PeriodList items={terms} onSetCurrent={onSetCurrent} />
    </div>
  );
}

// The Friday-reminder automation has had a real backend
// (controllers/schoolSettingsController.js) since early in the build, but
// no UI anywhere has ever exposed it — admins could not see or change it.
// This tab is the first real UI for it.
function ReminderSettingsTab() {
  const [settings, setSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  useEffect(() => {
    apiRequest("/settings/friday-reminders")
      .then((res) => { setSettings(res.data); setForm(res.data); })
      .catch((err) => setError(err.message));
    apiRequest("/sms-templates").then((res) => setTemplates(res.data.filter((t) => t.type === "friday_reminder")));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/settings/friday-reminders", {
        method: "PATCH",
        body: {
          fridayRemindersEnabled: form.friday_reminders_enabled,
          fridaySendTime: form.friday_send_time,
          fridayTemplateId: form.friday_template_id || null,
          reminderMinBalance: form.reminder_min_balance,
          reminderCooldownDays: form.reminder_cooldown_days,
        },
      });
      setSettings(form);
      showToast("Reminder settings saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !form) return <div className="mt-6"><ErrorState message={error} /></div>;
  if (!form) return <div className="mt-6"><LoadingSkeleton lines={3} /></div>;

  return (
    <div className="mt-6 max-w-xl">
      <Card2 className="p-5">
        <h2 className="font-semibold text-[var(--ink)]">Friday SMS Reminders</h2>
        <p className="mt-1 text-xs text-[var(--slate-quiet)]">Automatically remind parents with an outstanding balance, every Friday.</p>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <label className="flex min-h-[44px] items-center justify-between rounded-lg border border-[var(--border)] px-3">
            <span className="text-sm font-medium text-[var(--ink)]">Enable Friday reminders</span>
            <input
              type="checkbox" checked={!!form.friday_reminders_enabled}
              onChange={(e) => setForm((f) => ({ ...f, friday_reminders_enabled: e.target.checked }))}
              className="h-5 w-5"
            />
          </label>

          <Field label="Send time">
            <input type="time" value={form.friday_send_time?.slice(0, 5) || "08:00"} onChange={(e) => setForm((f) => ({ ...f, friday_send_time: e.target.value }))} className={inputClass} />
          </Field>

          <Field label="Message template">
            <select value={form.friday_template_id || ""} onChange={(e) => setForm((f) => ({ ...f, friday_template_id: e.target.value ? Number(e.target.value) : null }))} className={inputClass}>
              <option value="">No template selected</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {templates.length === 0 && (
            <p className="-mt-2 text-xs text-[var(--slate-quiet)]">
              No "Friday reminder" template yet — create one on the <a href="/dashboard/sms-templates" className="text-[var(--primary)] hover:underline">SMS Templates</a> page.
            </p>
          )}

          <Field label="Minimum balance to trigger a reminder (optional)">
            <input type="number" min="0" placeholder="e.g. 50" value={form.reminder_min_balance ?? ""} onChange={(e) => setForm((f) => ({ ...f, reminder_min_balance: e.target.value === "" ? null : e.target.value }))} className={inputClass} />
          </Field>

          <Field label="Cooldown between reminders, in days (optional)">
            <input type="number" min="0" placeholder="e.g. 7" value={form.reminder_cooldown_days ?? ""} onChange={(e) => setForm((f) => ({ ...f, reminder_cooldown_days: e.target.value === "" ? null : e.target.value }))} className={inputClass} />
          </Field>

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end">
            <Button2 type="submit" disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button2>
          </div>
        </form>
      </Card2>
      <Toast {...toast} onDismiss={dismissToast} />
    </div>
  );
}

export default function AcademicSetupPage() {
  const [tab, setTab] = useState("years");
  const [years, setYears] = useState(null);
  const [terms, setTerms] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [showAddYear, setShowAddYear] = useState(false);
  const [showAddTerm, setShowAddTerm] = useState(false);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/academic-years").then((res) => setYears(res.data)).catch((err) => setLoadError(err.message));
    apiRequest("/terms").then((res) => setTerms(res.data)).catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  async function setCurrentYear(id) {
    await apiRequest(`/academic-years/${id}/set-current`, { method: "PATCH" });
    load();
    showToast("Academic year set as current.");
  }
  async function setCurrentTerm(id) {
    await apiRequest(`/terms/${id}/set-current`, { method: "PATCH" });
    load();
    showToast("Term set as current.");
  }

  return (
    <DashboardShell>
      <h1 className="text-2xl font-bold text-[var(--ink)]">Academic Setup</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Manage academic years, terms and school settings.</p>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}

      <div className="mt-5 flex gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--slate-quiet)] hover:text-[var(--slate)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "years" && <YearsTab years={years} onSetCurrent={setCurrentYear} onAdd={() => setShowAddYear(true)} onNavTab={setTab} />}
      {tab === "terms" && <TermsTab terms={terms} onSetCurrent={setCurrentTerm} onAdd={() => setShowAddTerm(true)} />}
      {tab === "reminders" && <ReminderSettingsTab />}

      {showAddYear && <AddYearModal onClose={() => setShowAddYear(false)} onCreated={() => { load(); showToast("Academic year added."); }} />}
      {showAddTerm && <AddTermModal years={years || []} onClose={() => setShowAddTerm(false)} onCreated={() => { load(); showToast("Term added."); }} />}
      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
