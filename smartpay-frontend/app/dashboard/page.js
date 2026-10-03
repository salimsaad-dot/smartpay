"use client";

import { useAuth } from "@/context/AuthContext";
import DashboardShell from "@/components/DashboardShell";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <DashboardShell>
      <h1 className="text-2xl font-semibold text-[var(--ink)]">
        Welcome to {user?.school.name}
      </h1>
      <p className="mt-1 text-sm text-[var(--slate-quiet)]">
        Logged in as {user?.name} ({user?.email}) · School code: {user?.school.code}
      </p>
      <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] bg-white p-6 text-sm text-[var(--slate-quiet)]">
        Start with <strong>Academic Setup</strong> to create your first academic year and term,
        then add <strong>Classes</strong>, <strong>Students</strong>, and <strong>Parents</strong>.
        Fee structures, invoices, payments, and arrears reminders are coming in the next build phase.
      </div>
    </DashboardShell>
  );
}
