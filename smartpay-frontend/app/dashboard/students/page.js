"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Users, GraduationCap, UserPlus, UserX, Plus, School, Search,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
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

function AddStudentModal({ classes, years, onClose, onCreated }) {
  const [form, setForm] = useState({
    admissionNo: "", firstName: "", lastName: "", classId: "", academicYearId: "",
    parentFullName: "", parentPhone: "", relationship: "",
  });
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
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Student" description="Register a new student in your school." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Admission No."><input required value={form.admissionNo} onChange={(e) => setForm((f) => ({ ...f, admissionNo: e.target.value }))} className={inputClass} /></Field>
        <Field label="First Name"><input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} className={inputClass} /></Field>
        <Field label="Last Name"><input required value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} className={inputClass} /></Field>
        <Field label="Class">
          <select required value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))} className={inputClass}>
            <option value="">Select...</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Academic Year">
          <select required value={form.academicYearId} onChange={(e) => setForm((f) => ({ ...f, academicYearId: e.target.value }))} className={inputClass}>
            <option value="">Select...</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>
        </Field>

        <div className="border-t border-[var(--border)] pt-3">
          <p className="text-sm font-semibold text-[var(--ink)]">Parent / Guardian <span className="font-normal text-[var(--slate-quiet)]">(optional — can be added later instead)</span></p>
          <p className="mt-0.5 text-xs text-[var(--slate-quiet)]">
            Add it now to skip a separate step. If this phone number matches an existing parent, that record is reused — not duplicated.
          </p>
          <div className="mt-3 space-y-3">
            <Field label="Parent/Guardian Name"><input value={form.parentFullName} onChange={(e) => setForm((f) => ({ ...f, parentFullName: e.target.value }))} className={inputClass} /></Field>
            <Field label="Parent/Guardian Phone"><input value={form.parentPhone} onChange={(e) => setForm((f) => ({ ...f, parentPhone: e.target.value }))} className={inputClass} /></Field>
            <Field label="Relationship (optional)"><input placeholder="e.g. Mother, Father, Guardian" value={form.relationship} onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))} className={inputClass} /></Field>
          </div>
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button2 variant="secondary" type="button" onClick={onClose}>Cancel</Button2>
          <Button2 type="submit" disabled={saving}>{saving ? "Adding..." : "Add Student"}</Button2>
        </div>
      </form>
    </Modal>
  );
}

function ManageParentsModal({ student, parents, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [parentId, setParentId] = useState("");
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState("");

  function load() {
    apiRequest(`/students/${student.id}`).then((res) => setDetail(res.data));
  }
  useEffect(load, [student.id]);

  async function handleLink() {
    if (!parentId) return;
    setError("");
    try {
      await apiRequest(`/students/${student.id}/parents`, { method: "POST", body: { parentId: Number(parentId), relationship } });
      setParentId("");
      setRelationship("");
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Manage Parents" description={`${student.first_name} ${student.last_name} · ${student.admission_no}`} onClose={onClose}>
      {!detail ? (
        <LoadingSkeleton lines={2} />
      ) : (
        <>
          {detail.parents.length === 0 ? (
            <p className="text-sm text-[var(--slate-quiet)]">No parent/guardian linked yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {detail.parents.map((p) => (
                <li key={p.id} className="rounded-lg bg-[var(--hover)] p-2.5">
                  <p className="font-medium text-[var(--ink)]">{p.full_name}</p>
                  <p className="text-xs text-[var(--slate-quiet)]">{p.phone} · {p.relationship || "Guardian"}{p.is_primary ? " · Primary" : ""}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
            <Field label="Link a parent">
              <select aria-label="Link a parent" value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputClass}>
                <option value="">Select a parent...</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.phone})</option>)}
              </select>
            </Field>
            <Field label="Relationship (optional)">
              <input aria-label="Relationship" placeholder="e.g. Father" value={relationship} onChange={(e) => setRelationship(e.target.value)} className={inputClass} />
            </Field>
            {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
            <div className="flex justify-end">
              <Button2 onClick={handleLink} disabled={!parentId}>Link Parent</Button2>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function StudentsPageInner() {
  const searchParams = useSearchParams();
  const [students, setStudents] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [classes, setClasses] = useState([]);
  const [years, setYears] = useState([]);
  const [terms, setTerms] = useState([]);
  const [parents, setParents] = useState([]);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [managingStudent, setManagingStudent] = useState(null);
  const { toast, showToast, dismissToast } = useToast();

  function load() {
    setLoadError("");
    apiRequest("/students")
      .then((res) => setStudents(res.data))
      .catch((err) => setLoadError(err.message));
    apiRequest("/classes").then((res) => setClasses(res.data));
    apiRequest("/academic-years").then((res) => setYears(res.data));
    apiRequest("/terms").then((res) => setTerms(res.data));
    apiRequest("/parents").then((res) => setParents(res.data));
  }
  useEffect(load, []);

  const currentTerm = terms.find((t) => t.is_current);
  const filtered = (students || []).filter((s) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) || s.admission_no.toLowerCase().includes(q) || s.class_name.toLowerCase().includes(q);
    const matchesClass = !classFilter || String(s.class_id) === classFilter;
    const matchesStatus = !statusFilter || s.status === statusFilter;
    return matchesSearch && matchesClass && matchesStatus;
  });

  const classCounts = (students || []).reduce((acc, s) => {
    acc[s.class_name] = (acc[s.class_name] || 0) + 1;
    return acc;
  }, {});
  const newThisTerm = currentTerm
    ? (students || []).filter((s) => new Date(s.created_at) >= new Date(currentTerm.start_date)).length
    : null;
  const inactiveCount = (students || []).filter((s) => s.status === "inactive").length;

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Students</h1>
          <p className="mt-1 text-sm text-[var(--slate-quiet)]">Manage and view all students in your school.</p>
        </div>
        <Button2 onClick={() => setShowAddModal(true)}><Plus size={16} /> Add Student</Button2>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}

      {/* Stat cards */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Student summary">
        <StatCard icon={Users} tone="info" label="Total Students" value={students ? String(students.length) : null} hint="Enrolled in current academic year" />
        <StatCard icon={School} tone="success" label="By Class" value={students ? String(classes.length) : null} hint="Classes" />
        <StatCard icon={UserPlus} tone="violet" label="New This Term" value={currentTerm ? String(newThisTerm) : "—"} hint={currentTerm ? "Students enrolled" : "No current term set"} />
        <StatCard icon={UserX} tone="danger" label="Inactive" value={students ? String(inactiveCount) : null} hint="Students" />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          {/* Filters */}
          <Card2 className="flex flex-wrap items-center gap-3 p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--slate-quiet)]" />
              <input
                type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, admission number, or class..."
                className="w-full rounded-lg border border-[var(--border)] py-2.5 pl-9 pr-3 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
            </div>
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={`${inputClass} w-auto`}>
              <option value="">All Classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} w-auto`}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            {(search || classFilter || statusFilter) && (
              <LinkButton onClick={() => { setSearch(""); setClassFilter(""); setStatusFilter(""); }}>Reset</LinkButton>
            )}
          </Card2>

          {!students && !loadError && <div className="mt-4"><LoadingSkeleton lines={4} /></div>}

          {students && (
            <>
              {/* Phones: cards */}
              <div className="mt-4 space-y-3 xl:hidden">
                {filtered.length === 0 && <EmptyState>No students match these filters.</EmptyState>}
                {filtered.map((s) => (
                  <MobileRecordCard key={s.id}>
                    <div className="flex items-start gap-3">
                      <Avatar name={`${s.first_name} ${s.last_name}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-[var(--ink)]">{s.first_name} {s.last_name}</p>
                        <p className="truncate text-xs text-[var(--slate-quiet)]">{s.admission_no} · {s.class_name}</p>
                        {s.parent_name && <p className="truncate text-xs text-[var(--slate-quiet)]">{s.parent_name} · {s.parent_phone}</p>}
                      </div>
                      <Badge2 tone={s.status === "active" ? "success" : "danger"}>{s.status === "active" ? "Active" : "Inactive"}</Badge2>
                    </div>
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      <LinkButton onClick={() => setManagingStudent(s)}>Manage parents</LinkButton>
                    </div>
                  </MobileRecordCard>
                ))}
              </div>

              {/* Desktop: table */}
              <Card2 className="mt-4 hidden overflow-x-auto xl:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
                      <th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Admission No.</th><th className="p-3 font-medium">Class</th>
                      <th className="p-3 font-medium">Parent/Guardian</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--hover)]">
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={`${s.first_name} ${s.last_name}`} size={32} />
                            <span className="font-medium text-[var(--ink)]">{s.first_name} {s.last_name}</span>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-xs">{s.admission_no}</td>
                        <td className="p-3">{s.class_name}</td>
                        <td className="p-3">
                          {s.parent_name ? (
                            <><p>{s.parent_name}</p><p className="text-xs text-[var(--slate-quiet)]">{s.parent_phone}</p></>
                          ) : <span className="text-[var(--slate-quiet)]">—</span>}
                        </td>
                        <td className="p-3"><Badge2 tone={s.status === "active" ? "success" : "danger"}>{s.status === "active" ? "Active" : "Inactive"}</Badge2></td>
                        <td className="p-3 text-right"><LinkButton onClick={() => setManagingStudent(s)}>Manage parents</LinkButton></td>
                      </tr>
                    ))}
                    {filtered.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-[var(--slate-quiet)]">No students match these filters.</td></tr>}
                  </tbody>
                </table>
              </Card2>
            </>
          )}
        </div>

        {/* Sidebar: Quick Actions + Filter by Class */}
        <div className="space-y-6">
          <Card2 className="p-5">
            <h2 className="font-semibold text-[var(--ink)]">Quick Actions</h2>
            <div className="mt-3 space-y-2">
              <button onClick={() => setShowAddModal(true)} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-left text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)]">
                <UserPlus size={18} /> Add Student
              </button>
              <a href="/dashboard/classes" className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-[var(--border)] px-3 text-left text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)]">
                <School size={18} /> Manage Classes
              </a>
            </div>
          </Card2>

          <Card2 className="p-5">
            <h2 className="font-semibold text-[var(--ink)]">Filter by Class</h2>
            <div className="mt-3 space-y-1">
              <button
                onClick={() => setClassFilter("")}
                className={`flex min-h-[40px] w-full items-center justify-between rounded-lg px-3 text-sm ${!classFilter ? "bg-[var(--primary-wash)] font-semibold text-[var(--primary)]" : "text-[var(--slate)] hover:bg-[var(--hover)]"}`}
              >
                All Classes <span>{students?.length ?? "—"}</span>
              </button>
              {classes.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setClassFilter(String(c.id))}
                  className={`flex min-h-[40px] w-full items-center justify-between rounded-lg px-3 text-sm ${classFilter === String(c.id) ? "bg-[var(--primary-wash)] font-semibold text-[var(--primary)]" : "text-[var(--slate)] hover:bg-[var(--hover)]"}`}
                >
                  {c.name} <span>{classCounts[c.name] || 0}</span>
                </button>
              ))}
            </div>
          </Card2>
        </div>
      </div>

      {showAddModal && (
        <AddStudentModal classes={classes} years={years} onClose={() => setShowAddModal(false)} onCreated={() => { load(); showToast("Student added."); }} />
      )}
      {managingStudent && (
        <ManageParentsModal
          student={managingStudent}
          parents={parents}
          onClose={() => setManagingStudent(null)}
          onChanged={() => { load(); showToast("Parent linked."); }}
        />
      )}
      <Toast {...toast} onDismiss={dismissToast} />
    </DashboardShell>
  );
}

export default function StudentsPage() {
  return (
    <Suspense fallback={<DashboardShell><LoadingSkeleton lines={4} /></DashboardShell>}>
      <StudentsPageInner />
    </Suspense>
  );
}
