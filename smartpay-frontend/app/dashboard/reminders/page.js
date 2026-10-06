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
  StatusBadge,
  inputClass,
  statusTone,
} from "@/components/ui";

export default function RemindersPage() {
  const [reminders, setReminders] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    setLoadError("");
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    apiRequest(`/reminders?${params.toString()}`)
      .then((res) => setReminders(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, [statusFilter]);

  return (
    <DashboardShell>
      <PageHeader title="Reminder History" description="Every manual fee reminder sent, successful or not." />

      <div className="mt-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} w-full sm:w-56`}>
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!reminders && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {reminders && (
        <>
          {/* Phones: one card per reminder, message opens inline. */}
          <div className="mt-4 space-y-3 md:hidden">
            {reminders.length === 0 && <EmptyState>No reminders sent yet.</EmptyState>}
            {reminders.map((r) => (
              <MobileRecordCard key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ink)]">{r.parent_name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{r.phone} · {formatDate(r.created_at)}</p>
                  </div>
                  <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>
                </div>
                {r.failure_reason && <p className="mt-1 text-xs text-[var(--danger)]">{r.failure_reason}</p>}
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <LinkButton onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                    {expandedId === r.id ? "Hide message" : "View message"}
                  </LinkButton>
                </div>
                {expandedId === r.id && (
                  <p className="mt-3 rounded-lg bg-[var(--hover)] p-3 text-xs text-[var(--slate)]">{r.message}</p>
                )}
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Parent</th><th className="p-3 font-medium">Phone</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {reminders.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3">{formatDate(r.created_at)}</td>
                      <td className="p-3 font-medium">{r.parent_name}</td>
                      <td className="p-3">{r.phone}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>
                          {r.failure_reason && <span className="text-xs text-[var(--danger)]">{r.failure_reason}</span>}
                        </div>
                      </td>
                      <td className="p-3">
                        <LinkButton onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                          {expandedId === r.id ? "Hide" : "View message"}
                        </LinkButton>
                      </td>
                    </tr>
                    {expandedId === r.id && (
                      <tr className="border-b border-[var(--border)] bg-[var(--hover)]">
                        <td colSpan={5} className="p-3 text-xs text-[var(--slate)]">{r.message}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {reminders.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No reminders sent yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
