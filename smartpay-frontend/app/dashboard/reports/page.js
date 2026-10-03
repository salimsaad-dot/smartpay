"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney, formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

const TABS = [
  { key: "collection", label: "Collection Summary" },
  { key: "outstanding", label: "Outstanding Fees" },
  { key: "payments", label: "Payment History" },
  { key: "invoices", label: "Invoice Report" },
  { key: "sms", label: "SMS Activity" },
  { key: "statements", label: "Statements" },
];

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4">
      <p className="text-xs text-[var(--slate-quiet)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}

function CsvExportLink({ path, params }) {
  const query = new URLSearchParams({ ...params, format: "csv" }).toString();
  return (
    <a href={`${API_URL}${path}?${query}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-[var(--primary)] hover:underline">
      Export CSV
    </a>
  );
}

function FilterBar({ classes, terms, filters, setFilters, extra }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-white p-4">
      <div>
        <label className={labelClass}>Class</label>
        <select value={filters.classId} onChange={(e) => setFilters((f) => ({ ...f, classId: e.target.value }))} className={inputClass}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelClass}>Term</label>
        <select value={filters.termId} onChange={(e) => setFilters((f) => ({ ...f, termId: e.target.value }))} className={inputClass}>
          <option value="">All terms</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {extra}
    </div>
  );
}

function CollectionSummaryTab({ classes, terms, currency }) {
  const [filters, setFilters] = useState({ classId: "", termId: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.classId) params.set("classId", filters.classId);
    if (filters.termId) params.set("termId", filters.termId);
    apiRequest(`/reports/collection-summary?${params.toString()}`).then((res) => setData(res.data));
  }, [filters.classId, filters.termId]);

  return (
    <div className="space-y-4">
      <FilterBar classes={classes} terms={terms} filters={filters} setFilters={setFilters} />
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <SummaryCard label="Expected" value={formatMoney(data.expected, currency)} />
          <SummaryCard label="Collected" value={formatMoney(data.collected, currency)} />
          <SummaryCard label="Outstanding" value={formatMoney(data.outstanding, currency)} />
          <SummaryCard label="Collection Rate" value={`${data.collectionRate.toFixed(1)}%`} />
        </div>
      )}
    </div>
  );
}

function OutstandingFeesTab({ classes, terms, currency }) {
  const [filters, setFilters] = useState({ classId: "", termId: "", minBalance: "", maxBalance: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/outstanding-fees?${params.toString()}`).then((res) => setData(res.data));
  }, [filters.classId, filters.termId, filters.minBalance, filters.maxBalance]);

  return (
    <div className="space-y-4">
      <FilterBar
        classes={classes} terms={terms} filters={filters} setFilters={setFilters}
        extra={
          <>
            <div><label className={labelClass}>Min Balance</label><input type="number" value={filters.minBalance} onChange={(e) => setFilters((f) => ({ ...f, minBalance: e.target.value }))} className={inputClass} /></div>
            <div><label className={labelClass}>Max Balance</label><input type="number" value={filters.maxBalance} onChange={(e) => setFilters((f) => ({ ...f, maxBalance: e.target.value }))} className={inputClass} /></div>
            <CsvExportLink path="/reports/outstanding-fees" params={filters} />
          </>
        }
      />
      {data && (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
              <th className="p-3">Student</th><th className="p-3">Parent</th><th className="p-3">Class</th><th className="p-3">Term</th><th className="p-3">Balance</th><th className="p-3">Last Payment</th>
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
              {data.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-[var(--slate-quiet)]">No outstanding balances.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PaymentHistoryTab({ currency }) {
  const [filters, setFilters] = useState({ startDate: "", endDate: "", method: "", status: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/payment-history?${params.toString()}`).then((res) => setData(res.data));
  }, [filters.startDate, filters.endDate, filters.method, filters.status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-white p-4">
        <div><label className={labelClass}>From</label><input type="date" value={filters.startDate} onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} /></div>
        <div><label className={labelClass}>To</label><input type="date" value={filters.endDate} onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} /></div>
        <div>
          <label className={labelClass}>Method</label>
          <select value={filters.method} onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value }))} className={inputClass}>
            <option value="">All methods</option><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option>
            <option value="bank_transfer">Bank Transfer</option><option value="card">Card</option><option value="other">Other</option>
          </select>
        </div>
        <CsvExportLink path="/reports/payment-history" params={filters} />
      </div>
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard label="Total Collected" value={formatMoney(data.summary.totalCollected, currency)} />
            <SummaryCard label="Online" value={formatMoney(data.summary.onlineCollected, currency)} />
            <SummaryCard label="Manual" value={formatMoney(data.summary.manualCollected, currency)} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-3">Date</th><th className="p-3">Student</th><th className="p-3">Invoice</th><th className="p-3">Amount</th><th className="p-3">Method</th><th className="p-3">Source</th><th className="p-3">Status</th>
              </tr></thead>
              <tbody>
                {data.payments.map((p, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3">{formatDate(p.date)}</td><td className="p-3">{p.studentName}</td><td className="p-3 font-mono text-xs">{p.invoiceNo}</td>
                    <td className="p-3">{formatMoney(p.amount, currency)}</td><td className="p-3">{p.method || "—"}</td><td className="p-3">{p.source}</td><td className="p-3">{p.status}</td>
                  </tr>
                ))}
                {data.payments.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--slate-quiet)]">No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function InvoiceReportTab({ classes, terms, currency }) {
  const [filters, setFilters] = useState({ classId: "", termId: "", status: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/invoices?${params.toString()}`).then((res) => setData(res.data));
  }, [filters.classId, filters.termId, filters.status]);

  return (
    <div className="space-y-4">
      <FilterBar
        classes={classes} terms={terms} filters={filters} setFilters={setFilters}
        extra={
          <>
            <div>
              <label className={labelClass}>Status</label>
              <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={inputClass}>
                <option value="">All</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option><option value="void">Void</option>
              </select>
            </div>
            <CsvExportLink path="/reports/invoices" params={filters} />
          </>
        }
      />
      {data && (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
              <th className="p-3">Invoice No.</th><th className="p-3">Student</th><th className="p-3">Class</th><th className="p-3">Term</th><th className="p-3">Total</th><th className="p-3">Balance</th><th className="p-3">Status</th>
            </tr></thead>
            <tbody>
              {data.map((inv, i) => (
                <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-mono text-xs">{inv.invoiceNo}</td><td className="p-3">{inv.studentName}</td><td className="p-3">{inv.className}</td>
                  <td className="p-3">{inv.termName}</td><td className="p-3">{formatMoney(inv.total, currency)}</td><td className="p-3">{formatMoney(inv.balance, currency)}</td><td className="p-3">{inv.status}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--slate-quiet)]">No invoices.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SmsActivityTab() {
  const [filters, setFilters] = useState({ startDate: "", endDate: "", status: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    apiRequest(`/reports/sms-activity?${params.toString()}`).then((res) => setData(res.data));
  }, [filters.startDate, filters.endDate, filters.status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-white p-4">
        <div><label className={labelClass}>From</label><input type="date" value={filters.startDate} onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))} className={inputClass} /></div>
        <div><label className={labelClass}>To</label><input type="date" value={filters.endDate} onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))} className={inputClass} /></div>
        <CsvExportLink path="/reports/sms-activity" params={filters} />
      </div>
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard label="Sent" value={data.summary.sent} />
            <SummaryCard label="Failed" value={data.summary.failed} />
            <SummaryCard label="Total" value={data.summary.total} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-3">Date</th><th className="p-3">Parent</th><th className="p-3">Phone</th><th className="p-3">Status</th><th className="p-3">Failure Reason</th>
              </tr></thead>
              <tbody>
                {data.reminders.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3">{formatDate(r.date)}</td><td className="p-3">{r.parentName}</td><td className="p-3">{r.phone}</td>
                    <td className="p-3">{r.status}</td><td className="p-3 text-[var(--danger)]">{r.failureReason}</td>
                  </tr>
                ))}
                {data.reminders.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No reminders sent yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatementsTab({ currency }) {
  const [students, setStudents] = useState([]);
  const [parents, setParents] = useState([]);
  const [mode, setMode] = useState("student");
  const [selectedId, setSelectedId] = useState("");
  const [statement, setStatement] = useState(null);

  useEffect(() => {
    apiRequest("/students").then((res) => setStudents(res.data));
    apiRequest("/parents").then((res) => setParents(res.data));
  }, []);

  async function load() {
    if (!selectedId) return;
    const path = mode === "student" ? `/reports/student-statement/${selectedId}` : `/reports/parent-statement/${selectedId}`;
    const res = await apiRequest(path);
    setStatement(res.data);
  }

  const options = mode === "student" ? students : parents;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-white p-4 print:hidden">
        <div>
          <label className={labelClass}>Statement For</label>
          <select value={mode} onChange={(e) => { setMode(e.target.value); setSelectedId(""); setStatement(null); }} className={inputClass}>
            <option value="student">Student</option><option value="parent">Parent/Guardian</option>
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className={labelClass}>{mode === "student" ? "Student" : "Parent"}</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={inputClass}>
            <option value="">Select...</option>
            {options.map((o) => <option key={o.id} value={o.id}>{mode === "student" ? `${o.first_name} ${o.last_name}` : o.full_name}</option>)}
          </select>
        </div>
        <button onClick={load} disabled={!selectedId} className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          View Statement
        </button>
        {statement && (
          <button onClick={() => window.print()} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--slate-quiet)] hover:bg-gray-50">
            Print / Save as PDF
          </button>
        )}
      </div>

      {statement && (
        <div className="rounded-lg border border-[var(--border)] bg-white p-6">
          <h3 className="text-lg font-semibold text-[var(--ink)]">{statement.student ? statement.student.name : statement.parent.name}</h3>
          <p className="text-sm text-[var(--slate-quiet)]">{statement.student ? `${statement.student.admissionNo} · ${statement.student.className}` : statement.parent.phone}</p>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <SummaryCard label="Total Billed" value={formatMoney(statement.totalBilled, currency)} />
            <SummaryCard label="Total Paid" value={formatMoney(statement.totalPaid, currency)} />
            <SummaryCard label="Outstanding" value={formatMoney(statement.totalOutstanding, currency)} />
          </div>

          <h4 className="mt-5 font-semibold text-[var(--ink)]">Invoices</h4>
          <table className="mt-2 w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
              <th className="p-2">Invoice No.</th>{!statement.student && <th className="p-2">Student</th>}<th className="p-2">Term</th><th className="p-2">Total</th><th className="p-2">Balance</th><th className="p-2">Status</th>
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

          <h4 className="mt-5 font-semibold text-[var(--ink)]">Payments</h4>
          <table className="mt-2 w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
              <th className="p-2">Date</th>{!statement.student && <th className="p-2">Student</th>}<th className="p-2">Amount</th><th className="p-2">Method</th><th className="p-2">Status</th>
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
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Reports</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Collections, outstanding balances, payments, invoices, SMS activity, and individual statements.</p>

      <div className="mt-4 flex flex-wrap gap-1 border-b border-[var(--border)] print:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`rounded-t-lg px-3 py-2 text-sm font-medium ${activeTab === t.key ? "border-b-2 border-[var(--primary)] text-[var(--primary)]" : "text-[var(--slate-quiet)] hover:text-[var(--ink)]"}`}
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
