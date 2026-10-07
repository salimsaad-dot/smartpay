"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Users, UserCheck, UserX, Baby, Search, MoreHorizontal, ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/format";
import DashboardShell from "@/components/DashboardShell";
import {
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingSkeleton,
  Modal,
  MobileRecordCard,
  Toast,
  inputClass,
  useToast,
} from "@/components/ui";
import { Avatar, Badge2, Button2, Card2, StatCard } from "@/components/ui2";

const PAGE_SIZE = 6;

function AddParentModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", address: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/parents", { method: "POST", body: form });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Parent" description="Register a new parent/guardian." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Full Name"><input required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} className={inputClass} /></Field>
        <Field label="Phone"><input required value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputClass} /></Field>
        <Field label="Email (optional)"><input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputClass} /></Field>
        <Field label="Address (optional)"><input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputClass} /></Field>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button2 variant="secondary" type="button" onClick={onClose}>Cancel</Button2>
          <Button2 type="submit" disabled={saving}>{saving ? "Adding..." : "Add Parent"}</Button2>
        </div>
      </form>
    </Modal>
  );
}

function ChildrenModal({ parent, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest(`/parents/${parent.id}`).then((res) => setDetail(res.data)).catch((err) => setError(err.message));
  }, [parent.id]);

  return (
    <Modal title={parent.full_name} description="Linked children" onClose={onClose}>
      {error && <ErrorState message={error} />}
      {!detail && !error && <LoadingSkeleton lines={2} />}
      {detail && (
        detail.children.length === 0 ? (
          <p className="text-sm text-[var(--slate-quiet)]">No children linked yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.children.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg bg-[var(--hover)] p-2.5">
                <Avatar name={`${c.first_name} ${c.last_name}`} size={32} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">{c.first_name} {c.last_name}</p>
                  <p className="truncate text-xs text-[var(--slate-quiet)]">{c.class_name} · {c.relationship || "Guardian"}{c.is_primary ? " · Primary" : ""}</p>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </Modal>
  );
}

function PaymentLinkModal({ parent, onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    apiRequest(`/parents/${parent.id}/payment-link`, { method: "POST" })
      .then((res) => setState({ url: res.data.url }))
      .catch((err) => setState({ error: err.message }));
  }, [parent.id]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(state.url);
    } catch {
      // Clipboard API can fail/be blocked — the link is still visible and selectable.
    }
  }

  return (
    <Modal title="Payment Link" description={`For ${parent.full_name}'s outstanding balance — valid 30 days`} onClose={onClose}>
      {state.loading && <p className="text-sm text-[var(--slate-quiet)]">Generating...</p>}
      {state.error && <p className="text-sm text-[var(--danger)]">{state.error}</p>}
      {state.url && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--hover)] px-3 py-2 text-xs text-[var(--ink)]">{state.url}</code>
          <Button2 variant="secondary" onClick={copy}>Copy</Button2>
        </div>
      )}
      <div className="mt-4 flex justify-end"><Button2 variant="secondary" onClick={onClose}>Close</Button2></div>
    </Modal>
  );
}

function RowActions({ parent, onView, onPaymentLink, onToggleStatus }) {
  const [open, setOpen] = useState(false);
  const inactive = parent.status === "inactive";
  return (
    <div className="relative inline-block text-left">
      <button onClick={() => setOpen((o) => !o)} aria-label="Row actions" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--slate-quiet)] hover:bg-[var(--hover)]">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--shadow-soft)]">
            <button onClick={() => { setOpen(false); onView(parent); }} className="flex min-h-[40px] w-full items-center px-3 text-left text-sm text-[var(--slate)] hover:bg-[var(--hover)]">View children</button>
            <button onClick={() => { setOpen(false); onPaymentLink(parent); }} className="flex min-h-[40px] w-full items-center px-3 text-left text-sm text-[var(--slate)] hover:bg-[var(--hover)]">Payment link</button>
            <button onClick={() => { setOpen(false); onToggleStatus(parent, inactive ? "active" : "inactive"); }} className="flex min-h-[40px] w-full items-center px-3 text-left text-sm text-[var(--slate)] hover:bg-[var(--hover)]">{inactive ? "Reactivate" : "Mark inactive"}</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ParentsPage() {
  const { user } = useAuth();
  const currency = user?.school.currency;
  const [parents, setParents] = useState(null);
  const [classes, setClasses] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewingParent, setViewingParent] = useState(null);
  const [linkingParent, setLinkingParent] = useState(null);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/parents")
      .then((res) => setParents(res.data))
      .catch((err) => setLoadError(err.message));
    apiRequest("/classes").then((res) => setClasses(res.data));
  }
  useEffect(load, []);

  useEffect(() => { setPage(1); }, [search, classFilter, statusFilter]);

  async function toggleStatus(parent, status) {
    try {
      await apiRequest(`/parents/${parent.id}/status`, { method: "PATCH", body: { status } });
      load();
      showToast(status === "active" ? "Parent reactivated." : "Parent marked inactive.");
    } catch (err) {
      showToast(err.message, "danger");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (parents || []).filter((p) => {
      const matchesSearch = !q || p.full_name.toLowerCase().includes(q) || p.phone.includes(q) || (p.email || "").toLowerCase().includes(q);
      const childClassIds = (p.child_class_ids || "").split(",").filter(Boolean);
      const matchesClass = !classFilter || childClassIds.includes(classFilter);
      const matchesStatus = !statusFilter || p.status === statusFilter;
      return matchesSearch && matchesClass && matchesStatus;
    });
  }, [parents, search, classFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const list = parents || [];
    return {
      total: list.length,
      withChildren: list.filter((p) => Number(p.children_count) > 0).length,
      active: list.filter((p) => p.status === "active").length,
      inactive: list.filter((p) => p.status === "inactive").length,
    };
  }, [parents]);

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Parents</h1>
          <p className="mt-1 text-sm text-[var(--slate-quiet)]">Manage parent information and their children.</p>
        </div>
        <Button2 onClick={() => setShowAddModal(true)}><Plus size={16} /> Add Parent</Button2>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}

      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Parent summary">
        <StatCard icon={Users} tone="info" label="Total Parents" value={parents ? String(stats.total) : null} />
        <StatCard icon={Baby} tone="violet" label="With Children" value={parents ? String(stats.withChildren) : null} />
        <StatCard icon={UserCheck} tone="success" label="Active" value={parents ? String(stats.active) : null} />
        <StatCard icon={UserX} tone="danger" label="Inactive" value={parents ? String(stats.inactive) : null} />
      </section>

      <Card2 className="mt-6 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--slate-quiet)]" />
          <input
            type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parents by name, phone or email..."
            className="w-full rounded-lg border border-[var(--border)] py-2.5 pl-9 pr-3 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All Classes</option>
          {classes.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </Card2>

      {!parents && !loadError && <div className="mt-4"><LoadingSkeleton lines={4} /></div>}

      {parents && (
        <>
          <div className="mt-4 space-y-3 md:hidden">
            {pageItems.length === 0 && <EmptyState>No parents match these filters.</EmptyState>}
            {pageItems.map((p) => (
              <MobileRecordCard key={p.id}>
                <div className="flex items-start gap-3">
                  <Avatar name={p.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[var(--ink)]">{p.full_name}</p>
                    <p className="truncate text-xs text-[var(--slate-quiet)]">{p.phone}{p.email ? ` · ${p.email}` : ""}</p>
                  </div>
                  <Badge2 tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Inactive"}</Badge2>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-[var(--slate-quiet)]">Children</dt><dd className="font-medium text-[var(--ink)]">{p.children_count}</dd></div>
                  <div><dt className="text-[var(--slate-quiet)]">Outstanding</dt><dd className={`font-medium ${Number(p.outstanding_balance) > 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>{formatMoney(p.outstanding_balance, currency)}</dd></div>
                </dl>
                <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
                  <LinkButton onClick={() => setViewingParent(p)}>View children</LinkButton>
                  <RowActions parent={p} onView={setViewingParent} onPaymentLink={setLinkingParent} onToggleStatus={toggleStatus} />
                </div>
              </MobileRecordCard>
            ))}
          </div>

          <Card2 className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                  <th className="p-3 font-medium">Parent Name</th><th className="p-3 font-medium">Phone</th><th className="p-3 font-medium">Email</th>
                  <th className="p-3 font-medium">Children</th><th className="p-3 font-medium">Outstanding Balance</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={p.full_name} size={32} />
                        <span className="font-medium text-[var(--ink)]">{p.full_name}</span>
                      </div>
                    </td>
                    <td className="p-3">{p.phone}</td>
                    <td className="p-3">{p.email || <span className="text-[var(--slate-quiet)]">—</span>}</td>
                    <td className="p-3">{p.children_count}</td>
                    <td className={`p-3 font-medium ${Number(p.outstanding_balance) > 0 ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>{formatMoney(p.outstanding_balance, currency)}</td>
                    <td className="p-3"><Badge2 tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Inactive"}</Badge2></td>
                    <td className="p-3 text-right"><RowActions parent={p} onView={setViewingParent} onPaymentLink={setLinkingParent} onToggleStatus={toggleStatus} /></td>
                  </tr>
                ))}
                {pageItems.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-[var(--slate-quiet)]">No parents match these filters.</td></tr>}
              </tbody>
            </table>
          </Card2>

          {filtered.length > 0 && (
            <div className="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-xs text-[var(--slate-quiet)]">
                Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} parents
              </p>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--slate)] hover:bg-[var(--hover)] disabled:opacity-40">
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n} onClick={() => setPage(n)}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium ${n === page ? "bg-[var(--primary)] text-white" : "text-[var(--slate)] hover:bg-[var(--hover)]"}`}
                  >
                    {n}
                  </button>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--slate)] hover:bg-[var(--hover)] disabled:opacity-40">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showAddModal && <AddParentModal onClose={() => setShowAddModal(false)} onCreated={() => { load(); showToast("Parent/guardian added."); }} />}
      {viewingParent && <ChildrenModal parent={viewingParent} onClose={() => setViewingParent(null)} />}
      {linkingParent && <PaymentLinkModal parent={linkingParent} onClose={() => setLinkingParent(null)} />}
      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
