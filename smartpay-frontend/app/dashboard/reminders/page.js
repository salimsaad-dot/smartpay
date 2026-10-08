"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingSkeleton,
  MetricCard,
  MobileRecordCard,
  PageHeader,
  StatusBadge,
  Button,
  statusTone,
} from "@/components/ui";

const TABS = [
  { key: "", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "failed", label: "Failed" },
];

export default function RemindersPage() {
  const [reminders, setReminders] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    setLoadError("");
    apiRequest("/reminders")
      .then((res) => setReminders(res.data))
      .catch((err) => setLoadError(err.message));
  }
  useEffect(load, []);

  // Stat cards are computed from the one unfiltered fetch (same "fetch
  // once, filter client-side" pattern already used elsewhere in this
  // app) so the counts always reflect everything, not just whatever tab
  // is currently selected — matches how the Dashboard's own SMS card
  // derives sent-only vs. delivered from the raw status field.
  const stats = useMemo(() => {
    if (!reminders) return null;
    const delivered = reminders.filter((r) => r.status === "delivered").length;
    const sentOnly = reminders.filter((r) => r.status === "sent").length;
    const failed = reminders.filter((r) => r.status === "failed").length;
    return { total: reminders.length, sentOnly, delivered, failed };
  }, [reminders]);

  const filtered = useMemo(() => {
    if (!reminders) return [];
    if (!statusFilter) return reminders;
    return reminders.filter((r) => r.status === statusFilter);
  }, [reminders, statusFilter]);

  return (
    <DashboardShell>
      <PageHeader
        title="Reminders"
        description="Every fee reminder sent, successful or not."
        action={
          // No generic "create a reminder" flow exists — a reminder is
          // always sent in the context of a specific parent/invoice (from
          // Arrears, Students, or Parents), not from a blank slate here.
          // This links to where that actually happens rather than
          // pretending a standalone creation flow exists.
          <Link href="/dashboard/arrears">
            <Button>Send Reminders</Button>
          </Link>
        }
      />

      {stats && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Total" value={String(stats.total)} />
          <MetricCard label="Sent" value={String(stats.sentOnly)} />
          <MetricCard label="Delivered" value={String(stats.delivered)} tone="success" />
          <MetricCard label="Failed" value={String(stats.failed)} tone={stats.failed > 0 ? "danger" : "default"} />
        </div>
      )}

      <div className="mt-4 hidden overflow-x-auto border-b border-[var(--border)] md:flex">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            aria-current={statusFilter === t.key ? "page" : undefined}
            className={`flex-shrink-0 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium ${
              statusFilter === t.key ? "border-b-2 border-[var(--primary)] text-[var(--primary)]" : "text-[var(--slate-quiet)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Phones: same filter as a select, matching Reports' own mobile pattern. */}
      <div className="mt-4 md:hidden">
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm text-[var(--ink)]"
        >
          {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!reminders && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {reminders && (
        <>
          {/* Phones: one card per reminder, message opens inline. */}
          <div className="mt-4 space-y-3 md:hidden">
            {filtered.length === 0 && <EmptyState>No reminders match.</EmptyState>}
            {filtered.map((r) => (
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
                {filtered.map((r) => (
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
                {filtered.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No reminders match.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DashboardShell>
  );
}
