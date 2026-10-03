"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const STATUS_STYLES = {
  sent: "bg-green-50 text-[var(--success)]",
  delivered: "bg-green-50 text-[var(--success)]",
  failed: "bg-red-50 text-[var(--danger)]",
  pending: "bg-amber-50 text-amber-700",
};

export default function RemindersPage() {
  const [reminders, setReminders] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    apiRequest(`/reminders?${params.toString()}`).then((res) => setReminders(res.data));
  }
  useEffect(load, [statusFilter]);

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Reminder History</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Every manual fee reminder sent, successful or not.</p>

      <div className="mt-4 flex items-center gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {reminders && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-3">Date</th><th className="p-3">Parent</th><th className="p-3">Phone</th><th className="p-3">Status</th><th className="p-3"></th>
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
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status] || ""}`}>{r.status}</span>
                      {r.failure_reason && <span className="ml-2 text-xs text-[var(--danger)]">{r.failure_reason}</span>}
                    </td>
                    <td className="p-3">
                      <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="text-xs font-medium text-[var(--primary)] hover:underline">
                        {expandedId === r.id ? "Hide" : "View message"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr className="border-b border-[var(--border)] bg-gray-50">
                      <td colSpan={5} className="p-3 text-xs text-[var(--slate)]">{r.message}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {reminders.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No reminders sent yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
