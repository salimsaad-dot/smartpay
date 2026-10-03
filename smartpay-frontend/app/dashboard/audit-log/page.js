"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const ACTION_LABELS = {
  "payment.create": "Payment recorded",
  "payment.void": "Payment voided",
  "invoice.generate": "Invoices generated",
  "settings.update": "Settings updated",
  "sms_template.create": "SMS template created",
  "sms_template.update": "SMS template updated",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState(null);
  const [actionFilter, setActionFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    apiRequest(`/audit-logs?${params.toString()}`).then((res) => setLogs(res.data));
  }
  useEffect(load, [actionFilter]);

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Audit Log</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Every financial and administrative action, with who did it and when.</p>

      <div className="mt-4 flex items-center gap-2">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm">
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>

      {logs && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-3">Date</th><th className="p-3">User</th><th className="p-3">Action</th><th className="p-3">Entity</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <Fragment key={l.id}>
                  <tr className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3">{formatDate(l.created_at)}</td>
                    <td className="p-3 font-medium">{l.user_name || "System"}</td>
                    <td className="p-3">{ACTION_LABELS[l.action] || l.action}</td>
                    <td className="p-3 text-xs text-[var(--slate-quiet)]">{l.entity_type} #{l.entity_id}</td>
                    <td className="p-3">
                      <button onClick={() => setExpandedId(expandedId === l.id ? null : l.id)} className="text-xs font-medium text-[var(--primary)] hover:underline">
                        {expandedId === l.id ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === l.id && (
                    <tr className="border-b border-[var(--border)] bg-gray-50">
                      <td colSpan={5} className="p-3 text-xs text-[var(--slate)]">
                        {l.old_values_json && <div><span className="font-semibold">Before:</span> {l.old_values_json}</div>}
                        {l.new_values_json && <div><span className="font-semibold">After:</span> {l.new_values_json}</div>}
                        <div className="mt-1 text-[var(--slate-quiet)]">IP: {l.ip_address || "—"}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {logs.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No activity recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
