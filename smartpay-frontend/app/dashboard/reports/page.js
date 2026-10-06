"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney, formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingSkeleton,
  MetricCard,
  PageHeader,
  inputClass,
} from "@/components/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const TABS = [
  { key: "collection", label: "Collection Summary" },
  { key: "outstanding", label: "Outstanding Fees" },
  { key: "payments", label: "Payment History" },
  { key: "invoices", label: "Invoice Report" },
  { key: "sms", label: "SMS Activity" },
  { key: "statements", label: "Statements" },
];

function CsvExportLink({ path, params }) {
  const query = new URLSearchParams({ ...params, format: "csv" }).toString();
  return (
    <a
      href={`${API_URL}${path}?${query}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-[44px] items-center rounded-lg border border-[var(--border)] px-3 text-xs font-semibold text-[var(--slate)] hover:bg-[var(--hover)] sm:min-h-0 sm:py-2"
    >
      Export CSV
    </a>
  );
}

// Every tab shares this shell: filters → (loading | error | content).
function TabFrame({ loadError, loading, children }) {
  if (loadError) return <ErrorState message={loadError} />;
  if (loading) return <LoadingSkeleton lines={3} />;
  return children;
}

function FilterBar({ classes, terms, filters, setFilters, extra }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
      <Field label="Class">
        <select value={filters.classId} onChange={(e) => setFilters((f) => ({ ...f, classId: e.target.value }))} className={inputClass}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Term">
        <select value={filters.termId} onChange={(e) => setFilters((f) => ({ ...f, termId: e.target.value }))} className={inputClass}>
          <option value="">All terms</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      {extra}
    </div>
  );
}

function CollectionSummaryTab({ classes, terms, currency }) {
  const [filters, setFilters] = useState({ classId: "", termId: "" });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setLoadError("");
    const params = new URLSearchParams();
    if (filters.classId) params.set("classId", filters.classId);
    if (filters.termId) params.set("termId", filters.termId);
    apiRequest(`/reports/collection-summary?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.message));
  }, [filters.classId, filters.termId]);

  return (
    <div className="space-y-4">
      <FilterBar classes={classes} terms={terms} filters={filters} setFilters={setFilters} />
      <TabFrame loadError={loadError} loading={!data}>
        {data && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Expected" value={formatMoney(data.expected, currency)} />
            <MetricCard label="Collected" value={formatMoney(data.collected, currency)} tone="success" />
            <MetricCard label="Outstanding" value={formatMoney(data.outstanding, currency)} tone={data.outstanding > 0 ? "warning" : "default"} />
            <MetricCard label="Collection Rate" value={`${data.collectionRate.toFixed(1)}%`} />
          </div>
        )}
      </TabFrame>
    </div>
  );
}

function OutstandingFeesTab({ classes, terms, currency }) {
  const [filters, setFilters] = useState({ classId: "", termId: "", minBalance: "", maxBalance: "" });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setLoadError("");
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/outstanding-fees?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.message));
  }, [filters.classId, filters.termId, filters.minBalance, filters.maxBalance]);

  return (
    <div className="space-y-4">
      <FilterBar
        classes={classes} terms={terms} filters={filters} setFilters={setFilters}
        extra={
          <>
            <Field label="Min Balance"><input type="number" value={filters.minBalance} onChange={(e) => setFilters((f) => ({ ...f, minBalance: e.target.value }))} className={inputClass} /></Field>
            <Field label="Max Balance"><input type="number" value={filters.maxBalance} onChange={(e) => setFilters((f) => ({ ...f, maxBalance: e.target.value }))} className={inputClass} /></Field>
            <CsvExportLink path="/reports/outstanding-fees" params={filters} />
          </>
        }
      />
      <TabFrame loadError={loadError} loading={!data}>
        {data && (
          data.length === 0 ? <EmptyState>No outstanding balances.</EmptyState> : (
            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Student</th><th className="p-3 font-medium">Parent</th><th className="p-3 font-medium">Class</th><th className="p-3 font-medium">Term</th><th className="p-3 font-medium">Balance</th><th className="p-3 font-medium">Last Payment</th>
                </tr></thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3 font-medium">{r.studentName}</td><td className="p-3">{r.parentName || "—"}</td>
                      <td className="p-3">{r.className}</td><td className="p-3">{r.termName}</td>
                      <td className="p-3 font-semibold text-[var(--danger)]">{formatMoney(r.balance, currency)}</td>
                      <td className="p-3">{r.lastPaymentDate ? formatDate(r.lastPaymentDate) : "Never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </TabFrame>
    </div>
  );
}

function PaymentHistoryTab({ currency }) {
  const [filters, setFilters] = useState({ startDate: "", endDate: "", method: "", status: "" });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setLoadError("");
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/payment-history?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.message));
  }, [filters.startDate, filters.endDate, filters.method, filters.status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
        <Field label="From"><input type="date" value={filters.startDate} onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} /></Field>
        <Field label="To"><input type="date" value={filters.endDate} onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} /></Field>
        <Field label="Method">
          <select value={filters.method} onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value }))} className={inputClass}>
            <option value="">All methods</option><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option>
            <option value="bank_transfer">Bank Transfer</option><option value="card">Card</option><option value="other">Other</option>
          </select>
        </Field>
        <CsvExportLink path="/reports/payment-history" params={filters} />
      </div>
      <TabFrame loadError={loadError} loading={!data}>
        {data && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard label="Total Collected" value={formatMoney(data.summary.totalCollected, currency)} tone="success" />
              <MetricCard label="Online" value={formatMoney(data.summary.onlineCollected, currency)} />
              <MetricCard label="Manual" value={formatMoney(data.summary.manualCollected, currency)} />
            </div>
            {data.payments.length === 0 ? <EmptyState>No payments yet.</EmptyState> : (
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                    <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Student</th><th className="p-3 font-medium">Invoice</th><th className="p-3 font-medium">Amount</th><th className="p-3 font-medium">Method</th><th className="p-3 font-medium">Source</th><th className="p-3 font-medium">Status</th>
                  </tr></thead>
                  <tbody>
                    {data.payments.map((p, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                        <td className="p-3">{formatDate(p.date)}</td><td className="p-3">{p.studentName}</td><td className="p-3 font-mono text-xs">{p.invoiceNo}</td>
                        <td className="p-3">{formatMoney(p.amount, currency)}</td><td className="p-3">{p.method || "—"}</td><td className="p-3">{p.source}</td><td className="p-3">{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </TabFrame>
    </div>
  );
}

function InvoiceReportTab({ classes, terms, currency }) {
  const [filters, setFilters] = useState({ classId: "", termId: "", status: "" });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setLoadError("");
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/invoices?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.message));
  }, [filters.classId, filters.termId, filters.status]);

  return (
    <div className="space-y-4">
      <FilterBar
        classes={classes} terms={terms} filters={filters} setFilters={setFilters}
        extra={
          <>
            <Field label="Status">
              <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={inputClass}>
                <option value="">All</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option><option value="void">Void</option>
              </select>
            </Field>
            <CsvExportLink path="/reports/invoices" params={filters} />
          </>
        }
      />
      <TabFrame loadError={loadError} loading={!data}>
        {data && (
          data.length === 0 ? <EmptyState>No invoices.</EmptyState> : (
            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Invoice No.</th><th className="p-3 font-medium">Student</th><th className="p-3 font-medium">Class</th><th className="p-3 font-medium">Term</th><th className="p-3 font-medium">Total</th><th className="p-3 font-medium">Balance</th><th className="p-3 font-medium">Status</th>
                </tr></thead>
                <tbody>
                  {data.map((inv, i) => (
                    <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3 font-mono text-xs">{inv.invoiceNo}</td><td className="p-3">{inv.studentName}</td><td className="p-3">{inv.className}</td>
                      <td className="p-3">{inv.termName}</td><td className="p-3">{formatMoney(inv.total, currency)}</td><td className="p-3">{formatMoney(inv.balance, currency)}</td><td className="p-3">{inv.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </TabFrame>
    </div>
  );
}

function SmsActivityTab() {
  const [filters, setFilters] = useState({ startDate: "", endDate: "", status: "" });
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setLoadError("");
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/sms-activity?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.message));
  }, [filters.startDate, filters.endDate, filters.status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">
        <Field label="From"><input type="date" value={filters.startDate} onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} /></Field>
        <Field label="To"><input type="date" value={filters.endDate} onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} /></Field>
        <CsvExportLink path="/reports/sms-activity" params={filters} />
      </div>
      <TabFrame loadError={loadError} loading={!data}>
        {data && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard label="Sent" value={String(data.summary.sent)} tone="success" />
              <MetricCard label="Failed" value={String(data.summary.failed)} tone={data.summary.failed > 0 ? "danger" : "default"} />
              <MetricCard label="Total" value={String(data.summary.total)} />
            </div>
            {data.reminders.length === 0 ? <EmptyState>No reminders sent yet.</EmptyState> : (
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                    <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Parent</th><th className="p-3 font-medium">Phone</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Failure Reason</th>
                  </tr></thead>
                  <tbody>
                    {data.reminders.map((r, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                        <td className="p-3">{formatDate(r.date)}</td><td className="p-3">{r.parentName}</td><td className="p-3">{r.phone}</td>
                        <td className="p-3">{r.status}</td><td className="p-3 text-[var(--danger)]">{r.failureReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </TabFrame>
    </div>
  );
}

function StatementsTab({ currency }) {
  const [students, setStudents] = useState([]);
  const [parents, setParents] = useState([]);
  const [mode, setMode] = useState("student");
  const [selectedId, setSelectedId] = useState("");
  const [statement, setStatement] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    apiRequest("/students").then((res) => setStudents(res.data));
    apiRequest("/parents").then((res) => setParents(res.data));
  }, []);

  async function load() {
    if (!selectedId) return;
    setLoadError("");
    setStatement(null);
    try {
      const path = mode === "student" ? `/reports/student-statement/${selectedId}` : `/reports/parent-statement/${selectedId}`;
      const res = await apiRequest(path);
      setStatement(res.data);
    } catch (err) {
      setLoadError(err.message);
    }
  }

  const options = mode === "student" ? students : parents;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)] print:hidden">
        <Field label="Statement For">
          <select value={mode} onChange={(e) => { setMode(e.target.value); setSelectedId(""); setStatement(null); setLoadError(""); }} className={inputClass}>
            <option value="student">Student</option><option value="parent">Parent/Guardian</option>
          </select>
        </Field>
        <Field label={mode === "student" ? "Student" : "Parent"} className="min-w-[220px]">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={inputClass}>
            <option value="">Select...</option>
            {options.map((o) => <option key={o.id} value={o.id}>{mode === "student" ? `${o.first_name} ${o.last_name}` : o.full_name}</option>)}
          </select>
        </Field>
        <button onClick={load} disabled={!selectedId} className="flex min-h-[44px] items-center rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60 sm:min-h-0 sm:py-2">
          View Statement
        </button>
        {statement && (
          <button onClick={() => window.print()} className="flex min-h-[44px] items-center rounded-lg px-4 text-sm font-medium text-[var(--slate-quiet)] hover:bg-[var(--hover)] sm:min-h-0 sm:py-2">
            Print / Save as PDF
          </button>
        )}
      </div>

      {loadError && <ErrorState message={loadError} />}

      {statement && (
        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-[var(--shadow-card)]">
          <h3 className="text-lg font-semibold text-[var(--ink)]">{statement.student ? statement.student.name : statement.parent.name}</h3>
          <p className="text-sm text-[var(--slate-quiet)]">{statement.student ? `${statement.student.admissionNo} · ${statement.student.className}` : statement.parent.phone}</p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard label="Total Billed" value={formatMoney(statement.totalBilled, currency)} />
            <MetricCard label="Total Paid" value={formatMoney(statement.totalPaid, currency)} tone="success" />
            <MetricCard label="Outstanding" value={formatMoney(statement.totalOutstanding, currency)} tone={statement.totalOutstanding > 0 ? "warning" : "default"} />
          </div>

          <h4 className="mt-5 font-semibold text-[var(--ink)]">Invoices</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-2 font-medium">Invoice No.</th>{!statement.student && <th className="p-2 font-medium">Student</th>}<th className="p-2 font-medium">Term</th><th className="p-2 font-medium">Total</th><th className="p-2 font-medium">Balance</th><th className="p-2 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {statement.invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-2 font-mono text-xs">{inv.invoice_no}</td>
                    {!statement.student && <td className="p-2">{inv.first_name} {inv.last_name}</td>}
                    <td className="p-2">{inv.term_name}</td><td className="p-2">{formatMoney(inv.total, currency)}</td><td className="p-2">{formatMoney(inv.balance, currency)}</td><td className="p-2">{inv.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="mt-5 font-semibold text-[var(--ink)]">Payments</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-2 font-medium">Date</th>{!statement.student && <th className="p-2 font-medium">Student</th>}<th className="p-2 font-medium">Amount</th><th className="p-2 font-medium">Method</th><th className="p-2 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {statement.payments.map((p, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-2">{formatDate(p.paid_at || p.created_at)}</td>
                    {!statement.student && <td className="p-2">{p.first_name} {p.last_name}</td>}
                    <td className="p-2">{formatMoney(p.amount, currency)}</td><td className="p-2">{p.method || "—"}</td><td className="p-2">{p.status}</td>
                  </tr>
                ))}
                {statement.payments.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No payments recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("collection");
  const [classes, setClasses] = useState([]);
  const [terms, setTerms] = useState([]);

  useEffect(() => {
    apiRequest("/classes").then((res) => setClasses(res.data));
    apiRequest("/terms").then((res) => setTerms(res.data));
  }, []);

  const currency = user?.school.currency;

  return (
    <DashboardShell>
      <PageHeader title="Reports" description="Collections, outstanding balances, payments, invoices, SMS activity, and individual statements." />

      {/* Phones: a compact selector. Tablet/desktop: a scrollable tab bar — never wraps to multiple rows. */}
      <div className="mt-4 md:hidden print:hidden">
        <select value={activeTab} onChange={(e) => setActiveTab(e.target.value)} className={inputClass} aria-label="Select report">
          {TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div className="mt-4 hidden overflow-x-auto border-b border-[var(--border)] md:flex print:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            aria-current={activeTab === t.key ? "page" : undefined}
            className={`flex-shrink-0 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium ${activeTab === t.key ? "border-b-2 border-[var(--primary)] text-[var(--primary)]" : "text-[var(--slate-quiet)] hover:text-[var(--ink)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {activeTab === "collection" && <CollectionSummaryTab classes={classes} terms={terms} currency={currency} />}
        {activeTab === "outstanding" && <OutstandingFeesTab classes={classes} terms={terms} currency={currency} />}
        {activeTab === "payments" && <PaymentHistoryTab currency={currency} />}
        {activeTab === "invoices" && <InvoiceReportTab classes={classes} terms={terms} currency={currency} />}
        {activeTab === "sms" && <SmsActivityTab />}
        {activeTab === "statements" && <StatementsTab currency={currency} />}
      </div>
    </DashboardShell>
  );
}
