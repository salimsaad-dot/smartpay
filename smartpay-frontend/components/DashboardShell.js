"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/academic-setup", label: "Academic Setup" },
  { href: "/dashboard/classes", label: "Classes" },
  { href: "/dashboard/students", label: "Students" },
  { href: "/dashboard/parents", label: "Parents" },
  { href: "/dashboard/fee-structures", label: "Fee Structures" },
  { href: "/dashboard/invoices", label: "Invoices" },
  { href: "/dashboard/arrears", label: "Arrears" },
  { href: "/dashboard/reminders", label: "Reminders" },
  { href: "/dashboard/sms-templates", label: "SMS Templates" },
  { href: "/dashboard/reports", label: "Reports" },
  { href: "/dashboard/audit-log", label: "Audit Log" },
];

export default function DashboardShell({ children }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  // Closing on route change covers both a nav-link click and the
  // browser back/forward buttons, not just an explicit onClick per link.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (isLoading || !user) {
    return <p className="p-8 text-sm text-[var(--slate-quiet)]">Loading...</p>;
  }

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 transition-opacity md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 flex-shrink-0 -translate-x-full overflow-y-auto border-r border-[var(--border)] bg-white p-4 transition-transform duration-200 ease-in-out md:static md:z-auto md:w-56 md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : ""
        }`}
      >
        <span className="block px-2 text-lg font-semibold text-[var(--primary)]">SmartPay</span>
        <p className="mt-1 truncate px-2 text-xs text-[var(--slate-quiet)]">{user.school.name}</p>
        <nav className="mt-6 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                pathname === item.href
                  ? "bg-blue-50 text-[var(--primary)]"
                  : "text-[var(--slate)] hover:bg-gray-50"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          className="mt-8 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--slate-quiet)] hover:bg-gray-50"
        >
          Log out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[var(--border)] bg-white p-3 md:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[var(--slate)] hover:bg-gray-50 active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <span className="text-base font-semibold text-[var(--primary)]">SmartPay</span>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
