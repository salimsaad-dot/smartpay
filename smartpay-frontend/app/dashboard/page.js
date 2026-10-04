"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import DashboardShell from "@/components/DashboardShell";
import {
  AmountDisplay,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  statusTone,
} from "@/components/ui";
import { apiRequest } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

// Every figure here comes from an existing endpoint. Nothing is estimated or
// filled in client-side beyond slicing a list to its first few rows.
export default function DashboardPage() {
  const { user } = useAuth();
  const currency = user?.school?.currency || "GHS";

  const [collection, setCollection] = useState(null);
  const [arrears, setArrears] = useState(null);
  const [payments, setPayments] = useState(null);
  const [smsSummary, setSmsSummary] = useState(null);
  const [lastJob, setLastJob] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [collectionRes, arrearsRes, paymentsRes, smsRes, jobsRes] = await Promise.all([
          apiRequest("/reports/collection-summary"),
          apiRequest("/arrears"),
          apiRequest("/payments"),
          apiRequest("/reports/sms-activity"),
          apiRequest("/scheduled-jobs"),
        ]);
        if (cancelled) return;
        setCollection(collectionRes.data);
        setArrears(arrearsRes.data);
        setPayments(paymentsRes.data);
        setSmsSummary(smsRes.data.summary);
        setLastJob(jobsRes.data[0] ?? null);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load the dashboard.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasInvoices = collection && collection.invoiceCount > 0;

  return (
    <DashboardShell>
      <PageHeader
        title="Dashboard"
        description={`Fee collection overview for ${user?.school?.name}`}
      />

      {error && <div className="mt-6"><ErrorState message={error} /></div>}

      {!error && collection && !hasInvoices && (
        <div className="mt-6">
          <EmptyState>
            No invoices yet. Start with{" "}
            <Link href="/dashboard/academic-setup" className="font-medium text-[var(--primary)] hover:underline">Academic Setup</Link>,
            add your classes, students and parents, then generate invoices from Fee Structures.
          </EmptyState>
        </div>
      )}

      {/* 1 col on phones, 2 on small tablets, 4 on desktop */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Collection summary">
        <MetricCard
          label="Expected"
          value={collection ? formatMoney(collection.expected, currency) : null}
          hint={collection ? `${collection.invoiceCount} invoice${collection.invoiceCount === 1 ? "" : "s"}` : null}
        />
        <MetricCard
          label="Collected"
          value={collection ? formatMoney(collection.collected, currency) : null}
          hint={collection ? `${collection.collectionRate.toFixed(1)}% of expected` : null}
          tone="success"
        />
        <MetricCard
          label="Outstanding"
          value={collection ? formatMoney(collection.outstanding, currency) : null}
          hint={arrears ? `${arrears.summary.studentCount} student${arrears.summary.studentCount === 1 ? "" : "s"} in arrears` : null}
          tone={collection && collection.outstanding > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Reminders sent"
          value={smsSummary ? String(smsSummary.sent) : null}
          hint={smsSummary ? `${smsSummary.failed} failed of ${smsSummary.total}` : null}
          tone={smsSummary && smsSummary.failed > 0 ? "danger" : "default"}
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Largest outstanding balances"
          action={{ href: "/dashboard/arrears", label: "View arrears" }}
        >
          {!arrears ? (
            <LoadingSkeleton />
          ) : arrears.invoices.length === 0 ? (
            <EmptyState>No outstanding balances.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {arrears.invoices.slice(0, 5).map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">{inv.first_name} {inv.last_name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{inv.class_name} · {inv.term_name}</p>
                  </div>
                  <AmountDisplay amount={inv.balance} currency={currency} tone="warning" />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Last Friday reminder run" action={{ href: "/dashboard/reminders", label: "Reminders" }}>
          {lastJob === undefined ? (
            <LoadingSkeleton />
          ) : lastJob === null ? (
            <EmptyState>No reminder run has happened yet.</EmptyState>
          ) : (
            <dl className="space-y-3 text-sm">
              <Row label="Cycle" value={lastJob.cycle_key} />
              <Row label="Status" value={<StatusBadge tone={statusTone(lastJob.status)}>{lastJob.status}</StatusBadge>} />
              <Row label="Sent" value={String(lastJob.success_count)} />
              <Row label="Failed" value={String(lastJob.failure_count)} />
              <Row label="Finished" value={lastJob.finished_at ? formatDate(lastJob.finished_at) : "—"} />
            </dl>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Recent payments" action={{ href: "/dashboard/invoices", label: "View invoices" }}>
          {!payments ? (
            <LoadingSkeleton />
          ) : payments.length === 0 ? (
            <EmptyState>No payments recorded yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {payments.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">{p.first_name} {p.last_name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">
                      {formatDate(p.paid_at || p.created_at)} · {p.source === "online" ? "Online" : "Manual"} · Invoice {p.invoice_no}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <AmountDisplay amount={p.amount} currency={currency} />
                    <StatusBadge tone={statusTone(p.status)}>{p.status}</StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--slate-quiet)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-[var(--ink)]">{value}</dd>
    </div>
  );
}
