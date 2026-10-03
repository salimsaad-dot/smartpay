"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

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
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] bg-white p-4 sm:grid-cols-4">
      <div>
        <label className={labelClass}>Full Name</label>
        <input required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Phone</label>
        <input required value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Email (optional)</label>
        <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputClass} />
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={saving} className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          {saving ? "Adding..." : "Add Parent"}
        </button>
      </div>
      {error && <p className="sm:col-span-4 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

export default function ParentsPage() {
  const [parents, setParents] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [linkState, setLinkState] = useState({});

  function load() {
    apiRequest("/parents").then((res) => setParents(res.data));
  }
  useEffect(load, []);

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

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Parents / Guardians</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Linked children (siblings) are shown by expanding a row.</p>

      <div className="mt-4"><ParentForm onCreated={load} /></div>

      {parents && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">Email</th><th className="p-3"></th></tr></thead>
            <tbody>
              {parents.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{p.full_name}</td>
                    <td className="p-3">{p.phone}</td>
                    <td className="p-3">{p.email || "—"}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => toggleExpand(p.id)} className="text-xs font-medium text-[var(--primary)] hover:underline">
                        {expandedId === p.id ? "Hide children" : "View children"}
                      </button>
                      {" · "}
                      <button
                        onClick={() => generateLink(p.id)}
                        disabled={linkState[p.id]?.loading}
                        className="text-xs font-medium text-[var(--primary)] hover:underline disabled:opacity-60"
                      >
                        {linkState[p.id]?.loading ? "Generating..." : "Payment Link"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === p.id && detail && (
                    <tr className="border-b border-[var(--border)] bg-gray-50">
                      <td colSpan={4} className="p-3">
                        {detail.children.length === 0 ? (
                          <span className="text-xs text-[var(--slate-quiet)]">No children linked yet.</span>
                        ) : (
                          <ul className="space-y-1 text-xs text-[var(--slate)]">
                            {detail.children.map((c) => (
                              <li key={c.id}>
                                {c.first_name} {c.last_name} · {c.class_name} · {c.relationship || "Guardian"}{c.is_primary ? " (primary)" : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                  {linkState[p.id]?.url && (
                    <tr className="border-b border-[var(--border)] bg-blue-50">
                      <td colSpan={4} className="p-3">
                        <p className="text-xs text-[var(--slate-quiet)]">Share this link with {p.full_name} (e.g. via SMS) — it stays valid for 30 days:</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs text-[var(--ink)]">{linkState[p.id].url}</code>
                          <button onClick={() => copyLink(linkState[p.id].url)} className="rounded bg-[var(--primary)] px-2 py-1 text-xs font-semibold text-white hover:bg-[var(--primary-bright)]">
                            Copy
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {linkState[p.id]?.error && (
                    <tr className="border-b border-[var(--border)]">
                      <td colSpan={4} className="p-3 text-xs text-[var(--danger)]">{linkState[p.id].error}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {parents.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-[var(--slate-quiet)]">No parents yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
