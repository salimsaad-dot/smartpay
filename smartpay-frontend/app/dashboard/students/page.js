"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Users, UserPlus, UserX, Plus, School, Search, Upload, ChevronLeft,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import DashboardShell from "@/components/DashboardShell";
import BulkImportPanel from "@/components/BulkImportPanel";
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

const STUDENT_IMPORT_COLUMNS = [
  { header: "Admission No.", key: "admissionNo", required: true },
  { header: "First Name", key: "firstName", required: true },
  { header: "Last Name", key: "lastName", required: true },
  { header: "Middle Name", key: "middleName" },
  { header: "Class", key: "className", required: true },
  { header: "Academic Year", key: "academicYear" },
  { header: "Gender", key: "gender" },
  { header: "Date of Birth (YYYY-MM-DD)", key: "dateOfBirth" },
  { header: "Parent/Guardian Name", key: "parentFullName" },
  { header: "Parent/Guardian Phone", key: "parentPhone" },
  { header: "Relationship", key: "relationship" },
];

const STUDENT_IMPORT_EXAMPLE = [
  "S-2026-001", "Kofi", "Mensah", "", "Basic 1", "", "male", "2015-03-12",
  "Mrs Mensah", "0241234567", "Mother",
];

function AddStudentModal({ classes, years, presetClassId, onClose, onCreated }) {
  const [form, setForm] = useState({
    admissionNo: "", firstName: "", lastName: "", classId: presetClassId ? String(presetClassId) : "", academicYearId: "",
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

// One card per class on the landing view — clicking it drills into that
// class's roster (classFilter), the same role the old "Filter by Class"
// sidebar + "All Classes" dropdown used to play, just as the primary
// navigation instead of a secondary control.
function ClassCard({ cls, total, inactive, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] p-5 text-left shadow-[var(--shadow-soft)] transition-all hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-[var(--shadow-card)]"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-wash)] text-[var(--primary)]">
        <School size={18} />
      </div>
      <h3 className="mt-3 font-semibold text-[var(--ink)]">{cls.name}</h3>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">
        {total === 0 ? "No students yet" : `${total} student${total !== 1 ? "s" : ""}`}
      </p>
      {inactive > 0 && <p className="mt-0.5 text-xs text-[var(--slate-quiet)]">{inactive} inactive</p>}
    </button>
  );
}

function StudentRows({ list, onManageParents }) {
  if (list.length === 0) return <EmptyState>No students match.</EmptyState>;
  return (
    <>
      {/* Phones: cards */}
      <div className="space-y-3 xl:hidden">
        {list.map((s) => (
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
              <LinkButton onClick={() => onManageParents(s)}>Manage parents</LinkButton>
            </div>
          </MobileRecordCard>
        ))}
      </div>

      {/* Desktop: table */}
      <Card2 className="hidden overflow-x-auto xl:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs text-[var(--slate-quiet)]">
              <th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Admission No.</th><th className="p-3 font-medium">Class</th>
              <th className="p-3 font-medium">Parent/Guardian</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
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
                <td className="p-3 text-right"><LinkButton onClick={() => onManageParents(s)}>Manage parents</LinkButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card2>
    </>
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
  const [showInactive, setShowInactive] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
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
  const isSearching = search.trim().length > 0;

  // A non-empty search (typed here, or arriving via the top-nav search
  // redirect) always shows a flat cross-class match list — someone
  // looking a student up by name doesn't want to first guess their class.
  // Otherwise, no class selected = the card grid; a class selected = just
  // that class's roster. Search and "a class is open" are mutually
  // exclusive views, not combined, to keep the mental model to one thing
  // at a time.
  const searchResults = useMemo(() => {
    if (!isSearching || !students) return [];
    const q = search.trim().toLowerCase();
    return students.filter((s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      s.admission_no.toLowerCase().includes(q) ||
      s.class_name.toLowerCase().includes(q)
    );
  }, [isSearching, students, search]);

  const selectedClass = classes.find((c) => String(c.id) === classFilter);
  const classRoster = useMemo(() => {
    if (!students || !classFilter) return [];
    return students.filter((s) => String(s.class_id) === classFilter && (showInactive || s.status === "active"));
  }, [students, classFilter, showInactive]);
  const classInactiveCount = useMemo(() => {
    if (!students || !classFilter) return 0;
    return students.filter((s) => String(s.class_id) === classFilter && s.status === "inactive").length;
  }, [students, classFilter]);

  const classCounts = (students || []).reduce((acc, s) => {
    acc[s.class_id] = (acc[s.class_id] || 0) + 1;
    return acc;
  }, {});
  const classInactiveCounts = (students || []).reduce((acc, s) => {
    if (s.status === "inactive") acc[s.class_id] = (acc[s.class_id] || 0) + 1;
    return acc;
  }, {});
  const newThisTerm = currentTerm
    ? (students || []).filter((s) => new Date(s.created_at) >= new Date(currentTerm.start_date)).length
    : null;
  const inactiveCount = (students || []).filter((s) => s.status === "inactive").length;

  function selectClass(id) {
    setSearch("");
    setShowInactive(false);
    setClassFilter(id);
  }

  return (
    <DashboardShell>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Students</h1>
          <p className="mt-1 text-sm text-[var(--slate-quiet)]">Manage and view all students in your school.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button2 variant="secondary" onClick={() => setShowBulkImport((v) => !v)}>
            <Upload size={16} /> {showBulkImport ? "Hide Bulk Import" : "Bulk Import"}
          </Button2>
          <Button2 onClick={() => setShowAddModal(true)}><Plus size={16} /> Add Student</Button2>
        </div>
      </div>

      {loadError && <div className="mt-4"><ErrorState message={loadError} /></div>}

      {showBulkImport && (
        <div className="mt-6">
          <p className="mb-3 text-xs text-[var(--slate-quiet)]">
            Class and Academic Year are matched by name against what you&apos;ve already set up. Leave Academic Year blank to use whichever year is currently marked Current.
          </p>
          <BulkImportPanel
            columns={STUDENT_IMPORT_COLUMNS}
            exampleRow={STUDENT_IMPORT_EXAMPLE}
            templateFilename="student-bulk-import-template.xlsx"
            endpoint="/students/bulk-enroll"
            entityLabel="student"
            onImported={() => { load(); showToast("Students imported."); }}
          />
        </div>
      )}

      {/* Stat cards */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Student summary">
        <StatCard icon={Users} tone="info" label="Total Students" value={students ? String(students.length) : null} hint="Enrolled in current academic year" />
        <StatCard icon={School} tone="success" label="By Class" value={students ? String(classes.length) : null} hint="Classes" />
        <StatCard icon={UserPlus} tone="violet" label="New This Term" value={currentTerm ? String(newThisTerm) : "—"} hint={currentTerm ? "Students enrolled" : "No current term set"} />
        <StatCard icon={UserX} tone="danger" label="Inactive" value={students ? String(inactiveCount) : null} hint="Students" />
      </section>

      {/* Search — typing here always shows cross-class matches, overriding whatever view is open */}
      <Card2 className="mt-6 flex items-center gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--slate-quiet)]" />
          <input
            type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, admission number, or class..."
            className="w-full rounded-lg border border-[var(--border)] py-2.5 pl-9 pr-3 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </div>
        {isSearching && <LinkButton onClick={() => setSearch("")}>Clear</LinkButton>}
      </Card2>

      <div className="mt-6">
        {!students && !loadError && <LoadingSkeleton lines={4} />}

        {students && isSearching && (
          <>
            <p className="mb-3 text-sm text-[var(--slate-quiet)]">
              {searchResults.length} match{searchResults.length !== 1 ? "es" : ""} for &quot;{search.trim()}&quot;, across all classes
            </p>
            <StudentRows list={searchResults} onManageParents={setManagingStudent} />
          </>
        )}

        {students && !isSearching && !classFilter && (
          <>
            {classes.length === 0 ? (
              <EmptyState>No classes set up yet — add one on the Classes page first.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {classes.map((c) => (
                  <ClassCard
                    key={c.id}
                    cls={c}
                    total={classCounts[c.id] || 0}
                    inactive={classInactiveCounts[c.id] || 0}
                    onClick={() => selectClass(String(c.id))}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {students && !isSearching && classFilter && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <button onClick={() => setClassFilter("")} className="flex items-center gap-1 text-sm font-medium text-[var(--primary)] hover:underline">
                  <ChevronLeft size={16} /> All Classes
                </button>
                <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">{selectedClass?.name}</h2>
                <p className="text-sm text-[var(--slate-quiet)]">
                  {classRoster.length} student{classRoster.length !== 1 ? "s" : ""}
                  {!showInactive && classInactiveCount > 0 && ` · ${classInactiveCount} inactive hidden`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {classInactiveCount > 0 && (
                  <label className="flex items-center gap-1.5 text-sm text-[var(--slate-quiet)]">
                    <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4" />
                    Show inactive ({classInactiveCount})
                  </label>
                )}
                <Button2 onClick={() => setShowAddModal(true)}><Plus size={16} /> Add Student</Button2>
              </div>
            </div>
            <StudentRows list={classRoster} onManageParents={setManagingStudent} />
          </>
        )}
      </div>

      {showAddModal && (
        <AddStudentModal
          classes={classes} years={years} presetClassId={classFilter}
          onClose={() => setShowAddModal(false)}
          onCreated={() => { load(); showToast("Student added."); }}
        />
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
