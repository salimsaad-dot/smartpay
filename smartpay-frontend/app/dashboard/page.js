"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function DashboardPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  if (isLoading || !user) {
    return <p className="p-8 text-sm text-[var(--slate-quiet)]">Loading...</p>;
  }

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-white px-6 py-4">
        <span className="text-lg font-semibold text-[var(--primary)]">SmartPay</span>
        <button onClick={handleLogout} className="text-sm font-medium text-[var(--slate-quiet)] hover:text-[var(--ink)]">
          Log out
        </button>
      </header>
      <main className="p-8">
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Welcome to {user.school.name}</h1>
        <p className="mt-1 text-sm text-[var(--slate-quiet)]">
          Logged in as {user.name} ({user.email}) · School code: {user.school.code}
        </p>
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] bg-white p-6 text-sm text-[var(--slate-quiet)]">
          Academic setup, fee structures, invoices, payments, and arrears reminders are coming in the next build phases.
        </div>
      </main>
    </div>
  );
}
