"use client";

import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

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
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] bg-white p-4 sm:grid-cols-6">
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
        <button type="submit" disabled={saving} className="w-full rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-bright)] disabled:opacity-60">
          {saving ? "Adding..." : "Add Student"}
        </button>
      </div>
      {error && <p className="sm:col-span-6 text-sm text-[var(--danger)]">{error}</p>}
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
      <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={`${inputClass} w-auto`}>
        <option value="">Link a parent...</option>
        {parents.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.phone})</option>)}
      </select>
      <input placeholder="Relationship (e.g. Father)" value={relationship} onChange={(e) => setRelationship(e.target.value)} className={`${inputClass} w-auto`} />
      <button onClick={handleLink} className="rounded-lg border border-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary)] hover:bg-blue-50">Link</button>
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </div>
  );
}

export default function StudentsPage() {
  const [students, setStudents] = useState(null);
  const [classes, setClasses] = useState([]);
  const [years, setYears] = useState([]);
  const [parents, setParents] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);

  function load() {
    apiRequest("/students").then((res) => setStudents(res.data));
    apiRequest("/classes").then((res) => setClasses(res.data));
    apiRequest("/academic-years").then((res) => setYears(res.data));
    apiRequest("/parents").then((res) => setParents(res.data));
  }
  useEffect(load, []);

  async function toggleExpand(id) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    const res = await apiRequest(`/students/${id}`);
    setDetail(res.data);
  }

  async function refreshDetail(id) {
    const res = await apiRequest(`/students/${id}`);
    setDetail(res.data);
  }

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">Students</h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">Expand a student to link their parent(s)/guardian(s) — linking the same parent to multiple students makes them siblings.</p>

      <div className="mt-4"><StudentForm classes={classes} years={years} onCreated={load} /></div>

      {students && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]"><th className="p-3">Admission No.</th><th className="p-3">Name</th><th className="p-3">Class</th><th className="p-3">Year</th><th className="p-3"></th></tr></thead>
            <tbody>
              {students.map((s) => (
                <Fragment key={s.id}>
                  <tr className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3">{s.admission_no}</td>
                    <td className="p-3 font-medium">{s.first_name} {s.last_name}</td>
                    <td className="p-3">{s.class_name}</td>
                    <td className="p-3">{s.academic_year_name}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => toggleExpand(s.id)} className="text-xs font-medium text-[var(--primary)] hover:underline">
                        {expandedId === s.id ? "Hide" : "Manage parents"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === s.id && detail && (
                    <tr className="border-b border-[var(--border)] bg-gray-50">
                      <td colSpan={5} className="space-y-2 p-3">
                        {detail.parents.length > 0 && (
                          <ul className="space-y-1 text-xs text-[var(--slate)]">
                            {detail.parents.map((p) => (
                              <li key={p.id}>{p.full_name} ({p.phone}) · {p.relationship || "Guardian"}{p.is_primary ? " · primary" : ""}</li>
                            ))}
                          </ul>
                        )}
                        <LinkParentRow studentId={s.id} parents={parents} onLinked={() => refreshDetail(s.id)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {students.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-[var(--slate-quiet)]">No students yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </DashboardShell>
  );
}
