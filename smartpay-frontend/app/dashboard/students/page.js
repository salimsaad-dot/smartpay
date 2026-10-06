"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";
import {
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingSkeleton,
  MobileRecordCard,
  PageHeader,
  Toast,
  inputClass,
  labelClass,
  useToast,
} from "@/components/ui";

function StudentForm({ classes, years, onCreated }) {
  const [form, setForm] = useState({ admissionNo: "", firstName: "", lastName: "", classId: "", academicYearId: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await apiRequest("/students", {
        method: "POST",
        body: { ...form, classId: Number(form.classId), academicYearId: Number(form.academicYearId) },
      });
      setForm({ admissionNo: "", firstName: "", lastName: "", classId: "", academicYearId: "" });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)] sm:grid-cols-2 lg:grid-cols-6">
      <div>
        <label className={labelClass}>Admission No.</label>
        <input required value={form.admissionNo} onChange={(e) => setForm((f) => ({ ...f, admissionNo: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>First Name</label>
        <input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Last Name</label>
        <input required value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Class</label>
        <select required value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))} className={inputClass}>
          <option value="">Select...</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelClass}>Academic Year</label>
        <select required value={form.academicYearId} onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))} className={inputClass}>
          <option value="">Select...</option>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={saving} className="w-full">{saving ? "Adding..." : "Add Student"}</Button>
      </div>
      {error && <p className="sm:col-span-2 lg:col-span-6 text-sm text-[var(--danger)]">{error}</p>}
    </form>
  );
}

function LinkParentRow({ studentId, parents, onLinked }) {
  const [parentId, setParentId] = useState("");
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState("");

  async function handleLink() {
    if (!parentId) return;
    setError("");
    try {
      await apiRequest(`/students/${studentId}/parents`, { method: "POST", body: { parentId: Number(parentId), relationship } });
      setParentId("");
      setRelationship("");
      onLinked();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={`${inputClass} w-full sm:w-auto`}>
        <option value="">Link a parent...</option>
        {parents.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.phone})</option>)}
      </select>
      <input placeholder="Relationship (e.g. Father)" value={relationship} onChange={(e) => setRelationship(e.target.value)} className={`${inputClass} w-full sm:w-auto`} />
      <Button variant="secondary" onClick={handleLink}>Link</Button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </div>
  );
}

function ParentsList({ parents }) {
  if (parents.length === 0) {
    return <p className="text-xs text-[var(--slate-quiet)]">No parent/guardian linked yet.</p>;
  }
  return (
    <ul className="space-y-1 text-xs text-[var(--slate)]">
      {parents.map((p) => (
        <li key={p.id}>{p.full_name} ({p.phone}) · {p.relationship || "Guardian"}{p.is_primary ? " · primary" : ""}</li>
      ))}
    </ul>
  );
}

export default function StudentsPage() {
  const [students, setStudents] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [classes, setClasses] = useState([]);
  const [years, setYears] = useState([]);
  const [parents, setParents] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/students")
      .then((res) => setStudents(res.data))
      .catch((err) => setLoadError(err.message));
    apiRequest("/classes").then((res) => setClasses(res.data));
    apiRequest("/academic-years").then((res) => setYears(res.data));
    apiRequest("/parents").then((res) => setParents(res.data));
  }
  useEffect(load, []);

  function handleCreated() {
    load();
    showToast("Student added.");
  }

  async function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    const res = await apiRequest(`/students/${id}`);
    setDetail(res.data);
  }

  async function handleLinked(id) {
    const res = await apiRequest(`/students/${id}`);
    setDetail(res.data);
    showToast("Parent linked.");
  }

  return (
    <DashboardShell>
      <PageHeader
        title="Students"
        description="Expand a student to link their parent(s)/guardian(s) — linking the same parent to multiple students makes them siblings."
      />

      <div className="mt-4"><StudentForm classes={classes} years={years} onCreated={handleCreated} /></div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}
      {!students && !loadError && <div className="mt-6"><LoadingSkeleton lines={3} /></div>}

      {students && (
        <>
          {/* Phones: one card per student, link-parent form opens inline. */}
          <div className="mt-4 space-y-3 md:hidden">
            {students.length === 0 && <EmptyState>No students yet.</EmptyState>}
            {students.map((s) => (
              <MobileRecordCard key={s.id}>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-[var(--slate-quiet)]">{s.admission_no}</p>
                  <p className="truncate font-medium text-[var(--ink)]">{s.first_name} {s.last_name}</p>
                  <p className="truncate text-xs text-[var(--slate-quiet)]">{s.class_name} · {s.academic_year_name}</p>
                </div>
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <LinkButton onClick={() => toggleExpand(s.id)}>{expandedId === s.id ? "Hide" : "Manage parents"}</LinkButton>
                </div>
                {expandedId === s.id && detail && (
                  <div className="mt-3 space-y-2 rounded-lg bg-[var(--hover)] p-3">
                    <ParentsList parents={detail.parents} />
                    <LinkParentRow studentId={s.id} parents={parents} onLinked={() => handleLinked(s.id)} />
                  </div>
                )}
              </MobileRecordCard>
            ))}
          </div>

          {/* Desktop: table. */}
          <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] md:block">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3 font-medium">Admission No.</th><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Class</th><th className="p-3 font-medium">Year</th><th className="p-3 font-medium"></th></tr></thead>
              <tbody>
                {students.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="border-b border-[var(--border)] last:border-b-0">
                      <td className="p-3">{s.admission_no}</td>
                      <td className="p-3 font-medium">{s.first_name} {s.last_name}</td>
                      <td className="p-3">{s.class_name}</td>
                      <td className="p-3">{s.academic_year_name}</td>
                      <td className="p-3 text-right">
                        <LinkButton onClick={() => toggleExpand(s.id)}>{expandedId === s.id ? "Hide" : "Manage parents"}</LinkButton>
                      </td>
                    </tr>
                    {expandedId === s.id && detail && (
                      <tr className="border-b border-[var(--border)] bg-[var(--hover)]">
                        <td colSpan={5} className="space-y-2 p-3">
                          <ParentsList parents={detail.parents} />
                          <LinkParentRow studentId={s.id} parents={parents} onLinked={() => handleLinked(s.id)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {students.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No students yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}
