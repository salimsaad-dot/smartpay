"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingSkeleton,
  MobileRecordCard,
  PageHeader,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";

function ParentForm({ onCreated }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", address: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/parents", { method: "POST", body: form });
      setForm({ fullName: "", phone: "", email: "", address: "" });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Full Name">
        <input required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className={inputClass} />
      </Field>
      <Field label="Phone">
        <input required value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputClass} />
      </Field>
      <Field label="Email (optional)">
        <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputClass} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Adding..." : "Add Parent"}</Button>
      </div>
      {error && <p className="sm:col-span-2 lg:col-span-4 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

function ChildrenList({ children }) {
  if (children.length === 0) {
    return <span className="text-xs text-[var(--slate-quiet)]">No children linked yet.</span>;
  }
  return (
    <ul className="space-y-1 text-xs text-[var(--slate)]">
      {children.map((c) => (
        <li key={c.id}>{c.first_name} {c.last_name} · {c.class_name} · {c.relationship || "Guardian"}{c.is_primary ? " (primary)" : ""}</li>
      ))}
    </ul>
  );
}

function PaymentLinkBlock({ state, parentName, onCopy }) {
  if (state?.error) return <p className="text-xs text-[var(--danger)]">{state.error}</p>;
  if (!state?.url) return null;
  return (
    <div className="rounded-lg bg-[var(--primary-wash)] p-3">
      <p className="text-xs text-[var(--slate-quiet)]">Share this link with {parentName} (e.g. via SMS) — it stays valid for 30 days:</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-[var(--card)] px-2 py-1 text-xs text-[var(--ink)]">{state.url}</code>
        <Button variant="secondary" onClick={() => onCopy(state.url)}>Copy</Button>
      </div>
    </div>
  );
}

export default function ParentsPage() {
  const [parents, setParents] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [linkState, setLinkState] = useState({});
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/parents")
      .then((res) => setParents(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  function handleCreated() {
    load();
    showToast("Parent/guardian added.");
  }

  async function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    const res = await apiRequest(`/parents/${id}`);
    setDetail(res.data);
  }

  async function generateLink(id) {
    setLinkState((s) => ({ ...s, [id]: { loading: true } }));
    try {
      const res = await apiRequest(`/parents/${id}/payment-link`, { method: "POST" });
      setLinkState((s) => ({ ...s, [id]: { url: res.data.url } }));
    } catch (err) {
      setLinkState((s) => ({ ...s, [id]: { error: err.message } }));
    }
  }

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can fail/be blocked — the link is still visible and
      // selectable on screen, so this is a convenience, not a requirement.
    }
  }

  function actions(p) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <LinkButton onClick={() => toggleExpand(p.id)}>{expandedId === p.id ? "Hide children" : "View children"}</LinkButton>
        <LinkButton onClick={() => generateLink(p.id)} disabled={linkState[p.id]?.loading}>
          {linkState[p.id]?.loading ? "Generating..." : "Payment Link"}
        </LinkButton>
      </div>
    );
  }

  return (
    <DashboardShell>
      <PageHeader title="Parents / Guardians" description="Linked children (siblings) are shown by expanding a row." />

      <div className="mt-4"><ParentForm onCreated={handleCreated} /></div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!parents && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {parents && (
        <>
          {/* Phones: one card per parent. */}
          <div className="mt-4 space-y-3 md:hidden">
            {parents.length === 0 && <EmptyState>No parents yet.</EmptyState>}
            {parents.map((p) => (
              <MobileRecordCard key={p.id}>
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">{p.full_name}</p>
                  <p className="truncate text-xs text-[var(--slate-quiet)]">{p.phone}{p.email ? ` · ${p.email}` : ""}</p>
                </div>
                <div className="mt-3 border-t border-[var(--border)] pt-3">{actions(p)}</div>
                {expandedId === p.id && detail && (
                  <div className="mt-3 rounded-lg bg-[var(--hover)] p-3"><ChildrenList children={detail.children} /></div>
                )}
                {linkState[p.id] && (
                  <div className="mt-3"><PaymentLinkBlock state={linkState[p.id]} parentName={p.full_name} onCopy={copyLink} /></div>
                )}
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Phone</th><th className="p-3 font-medium">Email</th><th className="p-3 font-medium"></th></tr></thead>
              <tbody>
                {parents.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3 font-medium">{p.full_name}</td>
                      <td className="p-3">{p.phone}</td>
                      <td className="p-3">{p.email || "—"}</td>
                      <td className="p-3 text-right">{actions(p)}</td>
                    </tr>
                    {expandedId === p.id && detail && (
                      <tr className="border-b border-[var(--border)] bg-[var(--hover)]">
                        <td colSpan={4} className="p-3"><ChildrenList children={detail.children} /></td>
                      </tr>
                    )}
                    {linkState[p.id] && (
                      <tr className="border-b border-[var(--border)]">
                        <td colSpan={4} className="p-3"><PaymentLinkBlock state={linkState[p.id]} parentName={p.full_name} onCopy={copyLink} /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {parents.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-[var(--slate-quiet)]">No parents yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
