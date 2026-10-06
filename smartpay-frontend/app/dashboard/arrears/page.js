"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDate } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  AmountDisplay,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingSkeleton,
  MetricCard,
  MobileRecordCard,
  Modal,
  PageHeader,
  inputClass,
} from "@/components/ui";

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
      <div className="flex min-w-0 items-center gap-1">
        <code className="max-w-[140px] truncate rounded bg-[var(--hover)] px-1.5 py-0.5 text-xs">{state.url}</code>
        <LinkButton onClick={() => copy(state.url)}>Copy</LinkButton>
      </div>
    );
  }

  return (
    <LinkButton onClick={generate} disabled={state?.loading}>
      {state?.loading ? "Generating..." : "Payment Link"}
    </LinkButton>
  );
}

function SendReminderModal({ parentId, invoiceId, label, onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    apiRequest("/reminders/preview", { method: "POST", body: { parentId, invoiceId } })
      .then((res) => setPreview(res.data))
      .catch((err) => setError(err.message));
  }, [parentId, invoiceId]);

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      await apiRequest("/reminders/send", { method: "POST", body: { parentId, invoiceId } });
      setResult("success");
    } catch (err) {
      setError(err.message);
      setResult("failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Send Reminder" description={label} onClose={onClose}>
      {!preview && !error && <p className="text-sm text-[var(--slate-quiet)]">Loading preview...</p>}

      {preview && !result && (
        <>
          <p className="text-xs text-[var(--slate-quiet)]">To: {preview.phone}</p>
          <div className="mt-1 rounded-lg bg-[var(--hover)] p-3 text-sm text-[var(--ink)]">{preview.message}</div>
          {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending}>{sending ? "Sending..." : "Confirm & Send"}</Button>
          </div>
        </>
      )}

      {result === "success" && (
        <>
          <p className="text-sm text-[var(--success)]">Reminder sent.</p>
          <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </>
      )}
      {result === "failed" && (
        <>
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </>
      )}

      {error && !preview && (
        <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      )}
    </Modal>
  );
}

export default function ArrearsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [classes, setClasses] = useState([]);
  const [terms, setTerms] = useState([]);
  const [filters, setFilters] = useState({ classId: "", termId: "", minBalance: "", maxBalance: "" });
  const [groupByParent, setGroupByParent] = useState(false);
  const [reminderTarget, setReminderTarget] = useState(null);

  function load() {
    const params = new URLSearchParams();
    if (filters.classId) params.set("classId", filters.classId);
    if (filters.termId) params.set("termId", filters.termId);
    if (filters.minBalance) params.set("minBalance", filters.minBalance);
    if (filters.maxBalance) params.set("maxBalance", filters.maxBalance);
    setLoadError("");
    apiRequest(`/arrears?${params.toString()}`)
      .then((res) => setData(res.data))
      .catch((err) => setLoadError(err.message));
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

  function invoiceActions(inv) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PaymentLinkCell parentId={inv.parent_id} />
        {inv.parent_id && (
          <LinkButton
            onClick={() => setReminderTarget({ parentId: inv.parent_id, invoiceId: inv.id, label: `${inv.first_name} ${inv.last_name} · ${inv.term_name}` })}
          >
            Send Reminder
          </LinkButton>
        )}
      </div>
    );
  }

  function groupActions(g) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PaymentLinkCell parentId={g.parentId} />
        {g.parentId && (
          <LinkButton
            onClick={() => setReminderTarget({ parentId: g.parentId, invoiceId: null, label: `${g.parentName} · ${Array.from(g.children).join(", ")}` })}
          >
            Send Reminder
          </LinkButton>
        )}
      </div>
    );
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Arrears"
        description="Every invoice with an outstanding balance, across all terms unless filtered."
      />

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}

      {/* Balance leads: the outstanding total is the largest figure on the page. */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          featured
          label="Total outstanding"
          tone="danger"
          value={data ? <AmountDisplay amount={data.summary.totalOutstanding} currency={currency} tone="danger" size="xl" /> : null}
        />
        <MetricCard label="Students in arrears" value={data ? String(data.summary.studentCount) : null} />
        <MetricCard label="Invoices in arrears" value={data ? String(data.summary.invoiceCount) : null} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-5">
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
        <Field label="Min Balance">
          <input type="number" min="0" value={filters.minBalance} onChange={(e) => setFilters((f) => ({ ...f, minBalance: e.target.value }))} className={inputClass} />
        </Field>
        <Field label="Max Balance">
          <input type="number" min="0" value={filters.maxBalance} onChange={(e) => setFilters((f) => ({ ...f, maxBalance: e.target.value }))} className={inputClass} />
        </Field>
        <div className="flex items-end">
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-[var(--ink)]">
            <input type="checkbox" checked={groupByParent} onChange={(e) => setGroupByParent(e.target.checked)} className="h-4 w-4" />
            Group by parent
          </label>
        </div>
      </div>

      {!data && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {/* Invoice-level list. Table on desktop, stacked cards on phones. */}
      {data && !groupByParent && (
        <>
          <div className="mt-4 space-y-3 md:hidden">
            {data.invoices.length === 0 && <EmptyState>No outstanding balances — nothing in arrears.</EmptyState>}
            {data.invoices.map((inv) => (
              <MobileRecordCard key={inv.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ink)]">{inv.first_name} {inv.last_name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{inv.class_name} · {inv.term_name}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-[var(--slate-quiet)]">Balance</p>
                    <AmountDisplay amount={inv.balance} currency={currency} tone="danger" size="lg" />
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-[var(--slate-quiet)]">Parent/Guardian</dt><dd className="truncate font-medium text-[var(--ink)]">{inv.parent_name || "—"}</dd></div>
                  <div><dt className="text-[var(--slate-quiet)]">Last payment</dt><dd className="font-medium text-[var(--ink)]">{inv.last_payment_date ? formatDate(inv.last_payment_date) : "Never"}</dd></div>
                  <div><dt className="text-[var(--slate-quiet)]">Total</dt><dd><AmountDisplay amount={inv.total} currency={currency} /></dd></div>
                  <div><dt className="text-[var(--slate-quiet)]">Paid</dt><dd><AmountDisplay amount={inv.paid_amount} currency={currency} /></dd></div>
                </dl>
                <div className="mt-3 border-t border-[var(--border)] pt-3">{invoiceActions(inv)}</div>
              </MobileRecordCard>
            ))}
          </div>

          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Student</th><th className="p-3 font-medium">Parent/Guardian</th><th className="p-3 font-medium">Class</th><th className="p-3 font-medium">Term</th>
                  <th className="p-3 font-medium">Total</th><th className="p-3 font-medium">Paid</th><th className="p-3 font-medium">Balance</th><th className="p-3 font-medium">Last Payment</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{inv.first_name} {inv.last_name}</td>
                    <td className="p-3">{inv.parent_name || <span className="text-[var(--slate-quiet)]">—</span>}</td>
                    <td className="p-3">{inv.class_name}</td>
                    <td className="p-3">{inv.term_name}</td>
                    <td className="p-3"><AmountDisplay amount={inv.total} currency={currency} /></td>
                    <td className="p-3"><AmountDisplay amount={inv.paid_amount} currency={currency} /></td>
                    <td className="p-3"><AmountDisplay amount={inv.balance} currency={currency} tone="danger" size="lg" /></td>
                    <td className="p-3">{inv.last_payment_date ? formatDate(inv.last_payment_date) : <span className="text-[var(--slate-quiet)]">Never</span>}</td>
                    <td className="p-3">{invoiceActions(inv)}</td>
                  </tr>
                ))}
                {data.invoices.length === 0 && (
                  <tr><td colSpan={9} className="p-4 text-center text-[var(--slate-quiet)]">No outstanding balances — nothing in arrears.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Parent-grouped view. Same grouping logic, same two layouts. */}
      {data && groupByParent && (
        <>
          <div className="mt-4 space-y-3 md:hidden">
            {parentGroups.length === 0 && <EmptyState>No outstanding balances — nothing in arrears.</EmptyState>}
            {parentGroups.map((g) => (
              <MobileRecordCard key={g.parentId || "none"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ink)]">{g.parentName}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{g.parentPhone || "No phone"}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-[var(--slate-quiet)]">Total balance</p>
                    <AmountDisplay amount={g.totalBalance} currency={currency} tone="danger" size="lg" />
                  </div>
                </div>
                <p className="mt-3 text-xs text-[var(--slate)]">
                  <span className="text-[var(--slate-quiet)]">Children:</span> {Array.from(g.children).join(", ")}
                </p>
                <p className="mt-1 text-xs text-[var(--slate)]">
                  <span className="text-[var(--slate-quiet)]">Outstanding invoices:</span> {g.invoiceCount}
                </p>
                <div className="mt-3 border-t border-[var(--border)] pt-3">{groupActions(g)}</div>
              </MobileRecordCard>
            ))}
          </div>

          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Parent/Guardian</th><th className="p-3 font-medium">Phone</th><th className="p-3 font-medium">Children</th>
                  <th className="p-3 font-medium">Outstanding Invoices</th><th className="p-3 font-medium">Total Balance</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {parentGroups.map((g) => (
                  <tr key={g.parentId || "none"} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{g.parentName}</td>
                    <td className="p-3">{g.parentPhone || "—"}</td>
                    <td className="p-3">{Array.from(g.children).join(", ")}</td>
                    <td className="p-3">{g.invoiceCount}</td>
                    <td className="p-3"><AmountDisplay amount={g.totalBalance} currency={currency} tone="danger" size="lg" /></td>
                    <td className="p-3">{groupActions(g)}</td>
                  </tr>
                ))}
                {parentGroups.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-[var(--slate-quiet)]">No outstanding balances — nothing in arrears.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {reminderTarget && (
        <SendReminderModal
          parentId={reminderTarget.parentId}
          invoiceId={reminderTarget.invoiceId}
          label={reminderTarget.label}
          onClose={() => setReminderTarget(null)}
        />
      )}
    </DashboardShell>
  );
}
