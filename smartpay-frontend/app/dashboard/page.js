"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  FileText, Wallet, AlertTriangle, TrendingUp, CheckCircle2, XCircle,
  Receipt, Bell, ShieldAlert, BarChart3, Info,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import DashboardShell from "@/components/DashboardShell";
import { Avatar, Badge2, Card2, StatCard } from "@/components/ui2";
import { apiRequest } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function statusTone2(status) {
  if (["success", "sent", "delivered"].includes(status)) return "success";
  if (["failed"].includes(status)) return "danger";
  return "neutral";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const currency = user?.school?.currency || "GHS";

  const [collection, setCollection] = useState(null);
  const [arrears, setArrears] = useState(null);
  const [payments, setPayments] = useState(null);
  const [smsReminders, setSmsReminders] = useState(null);
  const [period, setPeriod] = useState(null); // { yearName, termName }
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Scoped to the current calendar month, not all-time — this
        // card answers "how much SMS have I used this billing period,"
        // which matters once multiple schools draw from one shared SMS
        // wallet and each needs to see their own real number rather
        // than take anyone's word for it. The full Reports > SMS
        // Activity page still covers any custom date range.
        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
        const [collectionRes, arrearsRes, paymentsRes, smsRes, yearsRes, termsRes] = await Promise.all([
          apiRequest("/reports/collection-summary"),
          apiRequest("/arrears"),
          apiRequest("/payments"),
          apiRequest(`/reports/sms-activity?startDate=${startOfMonth}`),
          apiRequest("/academic-years"),
          apiRequest("/terms"),
        ]);
        if (cancelled) return;
        setCollection(collectionRes.data);
        setArrears(arrearsRes.data);
        setPayments(paymentsRes.data);
        setSmsReminders(smsRes.data);
        const currentYear = yearsRes.data.find((y) => y.is_current);
        const currentTerm = termsRes.data.find((t) => t.is_current);
        setPeriod({ yearName: currentYear?.name, termName: currentTerm?.name });
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
  const chartData = collection
    ? [
        { name: "Expected", value: collection.expected, fill: "var(--primary)" },
        { name: "Collected", value: collection.collected, fill: "var(--success)" },
        { name: "Outstanding", value: collection.outstanding, fill: "var(--danger)" },
      ]
    : [];

  const smsDelivered = smsReminders?.reminders.filter((r) => r.status === "delivered").length ?? 0;
  const smsSentOnly = smsReminders ? smsReminders.summary.sent - smsDelivered : 0;
  const lastReminder = smsReminders?.reminders[0];

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">{greeting()}, {user?.name?.split(" ")[0]} 👋</h1>
          <p className="mt-1 text-sm text-[var(--slate-quiet)]">Here&apos;s what&apos;s happening at {user?.school?.name} today.</p>
        </div>
        {period?.yearName && (
          <Badge2 tone="info">{period.yearName}{period.termName ? ` · ${period.termName}` : ""}</Badge2>
        )}
      </div>

      {error && <div className="mt-6 rounded-lg bg-[var(--danger-wash)] p-4 text-sm text-[var(--danger)]" role="alert">{error}</div>}

      {!error && collection && !hasInvoices && (
        <div className="mt-6 rounded-[var(--radius-xl)] border border-dashed border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--slate-quiet)]">
          No invoices yet. Start with <Link href="/dashboard/academic-setup" className="font-medium text-[var(--primary)] hover:underline">Academic Setup</Link>,
          add your classes, students and parents, then generate invoices from Fee Structures.
        </div>
      )}

      {/* Stat cards */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Collection summary">
        <StatCard icon={FileText} tone="info" label="Expected Fees" value={collection ? formatMoney(collection.expected, currency) : null} hint={collection ? `Total fees for this term` : null} />
        <StatCard icon={Wallet} tone="success" label="Collected" value={collection ? formatMoney(collection.collected, currency) : null} hint={collection ? `${collection.collectionRate.toFixed(1)}% of expected` : null} />
        <StatCard icon={AlertTriangle} tone="danger" label="Outstanding" value={collection ? formatMoney(collection.outstanding, currency) : null} hint={arrears ? `${arrears.summary.studentCount} student${arrears.summary.studentCount === 1 ? "" : "s"} in arrears` : null} hintTone="danger" />
        <StatCard icon={TrendingUp} tone="violet" label="Collection Rate" value={collection ? `${collection.collectionRate.toFixed(1)}%` : null} hint={collection ? `${collection.invoiceCount} invoice${collection.invoiceCount === 1 ? "" : "s"}` : null} />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Collection Overview chart */}
        <Card2 className="p-5 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--ink)]">Collection Overview</h2>
            <span className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--slate-quiet)]">This Term</span>
          </div>
          {!collection ? (
            <div className="mt-4 h-64 animate-pulse rounded-lg bg-[var(--hover)]" />
          ) : (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barSize={64}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--slate-quiet)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "var(--slate-quiet)" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)} />
                  <Tooltip formatter={(v) => formatMoney(v, currency)} contentStyle={{ borderRadius: 8, borderColor: "var(--border)", fontSize: 13 }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {chartData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card2>

        {/* Recent Payments */}
        <Card2 className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--ink)]">Recent Payments</h2>
            <Link href="/dashboard/invoices" className="text-xs font-medium text-[var(--primary)] hover:underline">View all</Link>
          </div>
          <div className="mt-3">
            {!payments ? (
              <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-[var(--hover)]" />)}
              </div>
            ) : payments.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--slate-quiet)]">No payments recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {payments.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <Avatar name={`${p.first_name} ${p.last_name}`} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">{p.first_name} {p.last_name}</p>
                      <p className="truncate text-xs text-[var(--slate-quiet)]">{formatDate(p.paid_at || p.created_at)}</p>
                    </div>
                    <p className="flex-shrink-0 text-sm font-semibold text-[var(--ink)]">{formatMoney(p.amount, currency)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card2>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Outstanding Fees */}
        <Card2 className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--ink)]">Outstanding Fees</h2>
            <Link href="/dashboard/arrears" className="text-xs font-medium text-[var(--primary)] hover:underline">View all</Link>
          </div>
          <div className="mt-3">
            {!arrears ? (
              <div className="space-y-3" aria-hidden="true">
                {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-[var(--hover)]" />)}
              </div>
            ) : arrears.invoices.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--slate-quiet)]">No outstanding balances.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {arrears.invoices.slice(0, 5).map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">{inv.first_name} {inv.last_name}</p>
                      <p className="truncate text-xs text-[var(--slate-quiet)]">{inv.class_name}</p>
                    </div>
                    <p className="flex-shrink-0 text-sm font-semibold text-[var(--danger)]">{formatMoney(inv.balance, currency)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card2>

        {/* Reminder Activity — this calendar month, scoped per school */}
        <Card2 className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[var(--ink)]">SMS Usage This Month</h2>
            <Link href="/dashboard/reports" className="text-xs font-medium text-[var(--primary)] hover:underline">Other periods</Link>
          </div>
          {!smsReminders ? (
            <div className="mt-3 h-24 animate-pulse rounded-lg bg-[var(--hover)]" />
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-[var(--success-wash)] p-3 text-center">
                  <CheckCircle2 size={16} className="mx-auto text-[var(--success)]" />
                  <p className="mt-1 text-lg font-bold text-[var(--ink)]">{smsSentOnly}</p>
                  <p className="text-[11px] text-[var(--slate-quiet)]">Sent</p>
                </div>
                <div className="rounded-lg bg-[var(--primary-wash)] p-3 text-center">
                  <Bell size={16} className="mx-auto text-[var(--primary)]" />
                  <p className="mt-1 text-lg font-bold text-[var(--ink)]">{smsDelivered}</p>
                  <p className="text-[11px] text-[var(--slate-quiet)]">Delivered</p>
                </div>
                <div className="rounded-lg bg-[var(--danger-wash)] p-3 text-center">
                  <XCircle size={16} className="mx-auto text-[var(--danger)]" />
                  <p className="mt-1 text-lg font-bold text-[var(--ink)]">{smsReminders.summary.failed}</p>
                  <p className="text-[11px] text-[var(--slate-quiet)]">Failed</p>
                </div>
              </div>
              {lastReminder && (
                <p className="mt-3 text-xs text-[var(--slate-quiet)]">Last reminder: {formatDate(lastReminder.date)}</p>
              )}
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--hover)] p-2.5 text-xs text-[var(--slate-quiet)]">
                <Info size={14} className="mt-0.5 flex-shrink-0" />
                This is your school&apos;s own SMS count for the current calendar month, resetting on the 1st.
              </div>
            </>
          )}
        </Card2>

        {/* Quick Actions */}
        <Card2 className="p-5">
          <h2 className="font-semibold text-[var(--ink)]">Quick Actions</h2>
          <div className="mt-3 space-y-2">
            <Link href="/dashboard/invoices" className="flex min-h-[44px] items-center gap-3 rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-white hover:bg-[var(--primary-bright)]">
              <Receipt size={18} /> Generate Invoice
            </Link>
            <Link href="/dashboard/reminders" className="flex min-h-[44px] items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)]">
              <Bell size={18} /> Send Reminders
            </Link>
            <Link href="/dashboard/arrears" className="flex min-h-[44px] items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)]">
              <ShieldAlert size={18} /> View Arrears
            </Link>
            <Link href="/dashboard/reports" className="flex min-h-[44px] items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)]">
              <BarChart3 size={18} /> Generate Report
            </Link>
          </div>
        </Card2>
      </div>

      <div className="mt-6 flex flex-col items-center justify-between gap-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--slate-quiet)] sm:flex-row">
        <p>SmartPay · {user?.school?.name}</p>
        <p className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" /> Secure · Reliable</p>
      </div>
    </DashboardShell>
  );
}
