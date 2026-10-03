"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney, formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4">
      <p className="text-xs text-[var(--slate-quiet)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{value}</p>
    </div>
  );
}

function PaymentLinkCell({ parentId }) {
  const [state, setState] = useState(null);

  async function generate() {
    setState({ loading: true });
    try {
      const res = await apiRequest(`/parents/${parentId}/payment-link`, { method: "POST" });
      setState({ url: res.data.url });
    } catch (err) {
      setState({ error: err.message });
    }
  }

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can fail/be blocked — link stays visible on screen either way.
    }
  }

  if (!parentId) return <span className="text-xs text-[var(--slate-quiet)]">No parent linked</span>;

  if (state?.url) {
    return (
      <div className="flex items-center gap-1">
        <code className="max-w-[140px] truncate rounded bg-gray-50 px-1.5 py-0.5 text-xs">{state.url}</code>
        <button onClick={() => copy(state.url)} className="text-xs font-medium text-[var(--primary)] hover:underline">Copy</button>
      </div>
    );
  }

  return (
    <button onClick={generate} disabled={state?.loading} className="text-xs font-medium text-[var(--primary)] hover:underline disabled:opacity-60">
      {state?.loading ? "Generating..." : "Payment Link"}
    </button>
  );
}

export default function ArrearsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [classes, setClasses] = useState([]);
  const [terms, setTerms] = useState([]);
  const [filters, setFilters] = useState({ classId: "", termId: "", minBalance: "", maxBalance: "" });
  const [groupByParent, setGroupByParent] = useState(false);

  function load() {
    const params = new URLSearchParams();
    if (filters.classId) params.set("classId", filters.classId);
    if (filters.termId) params.set("termId", filters.termId);
    if (filters.minBalance) params.set("minBalance", filters.minBalance);
    if (filters.maxBalance) params.set("maxBalance", filters.maxBalance);
    apiRequest(`/arrears?${params.toString()}`).then((res) => setData(res.data));
  }
  useEffect(load, [filters.classId, filters.termId, filters.minBalance, filters.maxBalance]);

  useEffect(() => {
    apiRequest("/classes").then((res) => setClasses(res.data));
    apiRequest("/terms").then((res) => setTerms(res.data));
  }, []);

  const currency = user?.school.currency;

  const parentGroups = useMemo(() => {
    if (!data) return [];
    const groups = {};
    for (const inv of data.invoices) {
      const key = inv.parent_id || "none";
      if (!groups[key]) {
        groups[key] = { parentId: inv.parent_id, parentName: inv.parent_name || "No parent linked", parentPhone: inv.parent_phone, children: new Set(), totalBalance: 0, invoiceCount: 0 };
      }
      groups[key].children.add(`${inv.first_name} ${inv.last_name}`);
      groups[key].totalBalance += Number(inv.balance);
      groups[key].invoiceCount += 1;
    }
    return Object.values(groups).sort((a, b) => b.totalBalance - a.totalBalance);
  }, [data]);

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Arrears</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Every invoice with an outstanding balance, across all terms unless filtered.</p>

      {data && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard label="Total Outstanding" value={formatMoney(data.summary.totalOutstanding, currency)} />
          <SummaryCard label="Students in Arrears" value={data.summary.studentCount} />
          <SummaryCard label="Invoices in Arrears" value={data.summary.invoiceCount} />
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-[var(--border)] bg-white p-4 sm:grid-cols-5">
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
        <div>
          <label className={labelClass}>Min Balance</label>
          <input type="number" min="0" value={filters.minBalance} onChange={(e) => setFilters((f) => ({ ...f, minBalance: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Max Balance</label>
          <input type="number" min="0" value={filters.maxBalance} onChange={(e) => setFilters((f) => ({ ...f, maxBalance: e.target.value }))} className={inputClass} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
            <input type="checkbox" checked={groupByParent} onChange={(e) => setGroupByParent(e.target.checked)} />
            Group by parent
          </label>
        </div>
      </div>

      {data && !groupByParent && (
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-3">Student</th><th className="p-3">Parent/Guardian</th><th className="p-3">Class</th><th className="p-3">Term</th>
                <th className="p-3">Total</th><th className="p-3">Paid</th><th className="p-3">Balance</th><th className="p-3">Last Payment</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">{inv.first_name} {inv.last_name}</td>
                  <td className="p-3">{inv.parent_name || <span className="text-[var(--slate-quiet)]">—</span>}</td>
                  <td className="p-3">{inv.class_name}</td>
                  <td className="p-3">{inv.term_name}</td>
                  <td className="p-3">{formatMoney(inv.total, currency)}</td>
                  <td className="p-3">{formatMoney(inv.paid_amount, currency)}</td>
                  <td className="p-3 font-semibold text-[var(--danger)]">{formatMoney(inv.balance, currency)}</td>
                  <td className="p-3">{inv.last_payment_date ? formatDate(inv.last_payment_date) : <span className="text-[var(--slate-quiet)]">Never</span>}</td>
                  <td className="p-3"><PaymentLinkCell parentId={inv.parent_id} /></td>
                </tr>
              ))}
              {data.invoices.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-[var(--slate-quiet)]">No outstanding balances — nothing in arrears.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {data && groupByParent && (
        <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                <th className="p-3">Parent/Guardian</th><th className="p-3">Phone</th><th className="p-3">Children</th>
                <th className="p-3">Outstanding Invoices</th><th className="p-3">Total Balance</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {parentGroups.map((g) => (
                <tr key={g.parentId || "none"} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">{g.parentName}</td>
                  <td className="p-3">{g.parentPhone || "—"}</td>
                  <td className="p-3">{Array.from(g.children).join(", ")}</td>
                  <td className="p-3">{g.invoiceCount}</td>
                  <td className="p-3 font-semibold text-[var(--danger)]">{formatMoney(g.totalBalance, currency)}</td>
                  <td className="p-3"><PaymentLinkCell parentId={g.parentId} /></td>
                </tr>
              ))}
              {parentGroups.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-[var(--slate-quiet)]">No outstanding balances — nothing in arrears.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
