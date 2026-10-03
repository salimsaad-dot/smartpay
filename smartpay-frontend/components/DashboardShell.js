"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV_GROUPS = [
  { label: null, items: [{ href: "/dashboard", label: "Dashboard" }] },
  {
    label: "School setup",
    items: [
      { href: "/dashboard/academic-setup", label: "Academic Setup" },
      { href: "/dashboard/classes", label: "Classes" },
      { href: "/dashboard/students", label: "Students" },
      { href: "/dashboard/parents", label: "Parents" },
    ],
  },
  {
    label: "Fees & payments",
    items: [
      { href: "/dashboard/fee-structures", label: "Fee Structures" },
      { href: "/dashboard/invoices", label: "Invoices" },
      { href: "/dashboard/arrears", label: "Arrears" },
    ],
  },
  {
    label: "Reminders",
    items: [
      { href: "/dashboard/reminders", label: "Reminders" },
      { href: "/dashboard/sms-templates", label: "SMS Templates" },
    ],
  },
  { label: "Reports", items: [{ href: "/dashboard/reports", label: "Reports" }] },
  { label: "Admin", items: [{ href: "/dashboard/audit-log", label: "Audit Log" }] },
];

function NavLinks({ pathname, onNavigate }) {
  return (
    <nav className="mt-6 space-y-5" aria-label="Main">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? "main"}>
          {group.label && (
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--slate-quiet)]">{group.label}</p>
          )}
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--primary-wash)] text-[var(--primary)]"
                      : "text-[var(--slate)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function DashboardShell({ children }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

  // Closing on route change covers a nav-link click and the browser back
  // button alike, without wiring onClick into every single control.
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
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-shrink-0 -translate-x-full flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-4 transition-transform duration-200 ease-in-out md:static md:z-auto md:w-60 md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="px-2">
          <span className="block text-lg font-semibold text-[var(--primary)]">SmartPay</span>
          <p className="mt-1 truncate text-xs text-[var(--slate-quiet)]" title={user.school.name}>
            {user.school.name}
          </p>
        </div>
        <NavLinks pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
        <button
          onClick={handleLogout}
          className="mt-auto min-h-[44px] w-full rounded-lg px-3 text-left text-sm font-medium text-[var(--slate-quiet)] hover:bg-[var(--hover)]"
        >
          Log out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] p-3 md:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-[var(--slate)] hover:bg-[var(--hover)] active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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
