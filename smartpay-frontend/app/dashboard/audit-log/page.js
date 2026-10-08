"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingSkeleton,
  MobileRecordCard,
  PageHeader,
  inputClass,
} from "@/components/ui";

const ACTION_LABELS = {
  "payment.create": "Payment recorded",
  "payment.void": "Payment voided",
  "invoice.generate": "Invoices generated",
  "settings.update": "Settings updated",
  "sms_template.create": "SMS template created",
  "sms_template.update": "SMS template updated",
  "auth.login_success": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.login_blocked": "Sign-in blocked (account locked)",
  "auth.account_locked": "Account locked (too many failed attempts)",
  "auth.password_changed": "Password changed",
  "auth.password_reset": "Password reset via email link",
  "auth.sessions_revoked": "Logged out everywhere",
};

function LogDetails({ log }) {
  return (
    <div className="space-y-1">
      {log.old_values_json && <div><span className="font-semibold">Before:</span> {log.old_values_json}</div>}
      {log.new_values_json && <div><span className="font-semibold">After:</span> {log.new_values_json}</div>}
      <div className="text-[var(--slate-quiet)]">IP: {log.ip_address || "—"}</div>
    </div>
  );
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    setLoadError("");
    const params = new URLSearchParams();
    if (actionFilter) params.set("action", actionFilter);
    apiRequest(`/audit-logs?${params.toString()}`)
      .then((res) => setLogs(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, [actionFilter]);

  return (
    <DashboardShell>
      <PageHeader title="Audit Log" description="Every financial and administrative action, with who did it and when." />

      <div className="mt-4">
        <select aria-label="Filter by action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className={`${inputClass} w-full sm:w-64`}>
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!logs && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {logs && (
        <>
          {/* Phones: one card per entry, details open inline. */}
          <div className="mt-4 space-y-3 md:hidden">
            {logs.length === 0 && <EmptyState>No activity recorded yet.</EmptyState>}
            {logs.map((l) => (
              <MobileRecordCard key={l.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ink)]">{ACTION_LABELS[l.action] || l.action}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{l.user_name || "System"} · {formatDate(l.created_at)}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{l.entity_type} #{l.entity_id}</p>
                  </div>
                </div>
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <LinkButton onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                    {expandedId === l.id ? "Hide details" : "Details"}
                  </LinkButton>
                </div>
                {expandedId === l.id && (
                  <div className="mt-3 rounded-lg bg-[var(--hover)] p-3 text-xs text-[var(--slate)]"><LogDetails log={l} /></div>
                )}
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">User</th><th className="p-3 font-medium">Action</th><th className="p-3 font-medium">Entity</th><th className="p-3 font-medium"></th>
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
                        <LinkButton onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}>
                          {expandedId === l.id ? "Hide" : "Details"}
                        </LinkButton>
                      </td>
                    </tr>
                    {expandedId === l.id && (
                      <tr className="border-b border-[var(--border)] bg-[var(--hover)]">
                        <td colSpan={5} className="p-3 text-xs text-[var(--slate)]"><LogDetails log={l} /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {logs.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No activity recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
