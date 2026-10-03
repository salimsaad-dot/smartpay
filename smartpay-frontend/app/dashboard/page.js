"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import DashboardShell from "@/components/DashboardShell";
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
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--slate-quiet)]">
          Fee collection overview for {user?.school?.name}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-[var(--danger-wash)] p-4 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      {!error && collection && !hasInvoices && (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--slate-quiet)]">
          No invoices yet. Start with <Link href="/dashboard/academic-setup" className="font-medium text-[var(--primary)] hover:underline">Academic Setup</Link>,
          add your classes, students and parents, then generate invoices from Fee Structures.
        </div>
      )}

      {/* Stat cards: 1 col on phones, 2 on small tablets, 4 on desktop */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Collection summary">
        <StatCard
          label="Expected"
          value={collection ? formatMoney(collection.expected, currency) : null}
          hint={collection ? `${collection.invoiceCount} invoice${collection.invoiceCount === 1 ? "" : "s"}` : null}
        />
        <StatCard
          label="Collected"
          value={collection ? formatMoney(collection.collected, currency) : null}
          hint={collection ? `${collection.collectionRate.toFixed(1)}% of expected` : null}
          tone="success"
        />
        <StatCard
          label="Outstanding"
          value={collection ? formatMoney(collection.outstanding, currency) : null}
          hint={arrears ? `${arrears.summary.studentCount} student${arrears.summary.studentCount === 1 ? "" : "s"} in arrears` : null}
          tone={collection && collection.outstanding > 0 ? "warning" : undefined}
        />
        <StatCard
          label="Reminders sent"
          value={smsSummary ? String(smsSummary.sent) : null}
          hint={smsSummary ? `${smsSummary.failed} failed of ${smsSummary.total}` : null}
          tone={smsSummary && smsSummary.failed > 0 ? "danger" : undefined}
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Outstanding preview */}
        <Panel
          className="lg:col-span-2"
          title="Largest outstanding balances"
          action={{ href: "/dashboard/arrears", label: "View arrears" }}
        >
          {!arrears ? (
            <Placeholder />
          ) : arrears.invoices.length === 0 ? (
            <Empty>No outstanding balances.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {arrears.invoices.slice(0, 5).map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {inv.first_name} {inv.last_name}
                    </p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">
                      {inv.class_name} · {inv.term_name}
                    </p>
                  </div>
                  <p className="flex-shrink-0 text-sm font-semibold text-[var(--warning)]">
                    {formatMoney(inv.balance, currency)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Friday reminder run */}
        <Panel title="Last Friday reminder run" action={{ href: "/dashboard/reminders", label: "Reminders" }}>
          {lastJob === undefined ? (
            <Placeholder />
          ) : lastJob === null ? (
            <Empty>No reminder run has happened yet.</Empty>
          ) : (
            <dl className="space-y-3 text-sm">
              <Row label="Cycle" value={lastJob.cycle_key} />
              <Row label="Status" value={<StatusText status={lastJob.status} />} />
              <Row label="Sent" value={String(lastJob.success_count)} />
              <Row label="Failed" value={String(lastJob.failure_count)} />
              <Row label="Finished" value={lastJob.finished_at ? formatDate(lastJob.finished_at) : "—"} />
            </dl>
          )}
        </Panel>
      </div>

      {/* Recent payments */}
      <div className="mt-6">
        <Panel title="Recent payments" action={{ href: "/dashboard/invoices", label: "View invoices" }}>
          {!payments ? (
            <Placeholder />
          ) : payments.length === 0 ? (
            <Empty>No payments recorded yet.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {payments.slice(0, 5).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {p.first_name} {p.last_name}
                    </p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">
                      {formatDate(p.paid_at || p.created_at)} · {p.source === "online" ? "Online" : "Manual"} · Invoice {p.invoice_no}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <p className="text-sm font-semibold text-[var(--ink)]">{formatMoney(p.amount, currency)}</p>
                    <StatusText status={p.status} />
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

const TONE_CLASS = {
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
};

function StatCard({ label, value, hint, tone }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-quiet)]">{label}</p>
      {value === null ? (
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-[var(--hover)]" />
      ) : (
        <p className={`mt-2 break-words text-xl font-semibold ${tone ? TONE_CLASS[tone] : "text-[var(--ink)]"}`}>{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-[var(--slate-quiet)]">{hint}</p>}
    </div>
  );
}

function Panel({ title, action, className = "", children }) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        {action && (
          <Link href={action.href} className="flex min-h-[44px] items-center text-sm font-medium text-[var(--primary)] hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </section>
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

function StatusText({ status }) {
  const tone =
    status === "success" || status === "completed" || status === "sent" || status === "delivered"
      ? "text-[var(--success)]"
      : status === "failed"
        ? "text-[var(--danger)]"
        : "text-[var(--slate-quiet)]";
  return <span className={`text-xs font-medium capitalize ${tone}`}>{status}</span>;
}

function Placeholder() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--hover)]" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--hover)]" />
    </div>
  );
}

function Empty({ children }) {
  return <p className="py-4 text-sm text-[var(--slate-quiet)]">{children}</p>;
}
