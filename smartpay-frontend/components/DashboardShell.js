"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, School, GraduationCap, Users,
  Receipt, FileText, AlertTriangle, Bell, MessageSquareText, Wallet,
  BarChart3, ClipboardList, LogOut, ChevronDown, Menu, X, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Logo, LogoMark } from "@/components/Logo";
import { SearchBar } from "@/components/ui2";
import ThemeToggle from "@/components/ThemeToggle";

const NAV_GROUPS = [
  { label: null, items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "School setup",
    items: [
      { href: "/dashboard/academic-setup", label: "Academic Setup", icon: CalendarDays },
      { href: "/dashboard/classes", label: "Classes", icon: School },
      { href: "/dashboard/students", label: "Students", icon: GraduationCap },
      { href: "/dashboard/parents", label: "Parents", icon: Users },
    ],
  },
  {
    label: "Fees & payments",
    items: [
      { href: "/dashboard/fee-structures", label: "Fee Structures", icon: FileText },
      { href: "/dashboard/invoices", label: "Invoices", icon: Receipt },
      { href: "/dashboard/payments", label: "Payments", icon: Wallet },
      { href: "/dashboard/arrears", label: "Arrears", icon: AlertTriangle },
    ],
  },
  {
    label: "Reminders",
    items: [
      { href: "/dashboard/reminders", label: "Reminders", icon: Bell },
      { href: "/dashboard/sms-templates", label: "SMS Templates", icon: MessageSquareText },
    ],
  },
  { label: "Reports", items: [{ href: "/dashboard/reports", label: "Reports", icon: BarChart3 }] },
  {
    label: "Admin",
    items: [
      { href: "/dashboard/audit-log", label: "Audit Log", icon: ClipboardList },
      { href: "/dashboard/account", label: "Account & Security", icon: ShieldCheck },
    ],
  },
];

function NavLinks({ pathname, onNavigate }) {
  return (
    <nav className="mt-6 flex-1 space-y-5 overflow-y-auto px-3" aria-label="Main">
      {NAV_GROUPS.map((group) => (
        <div key={group.label ?? "main"}>
          {group.label && (
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--sidebar-ink-muted)]">{group.label}</p>
          )}
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                    active
                      ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-ink)]"
                      : "text-[var(--sidebar-ink)] hover:bg-[var(--sidebar-hover)] hover:text-white"
                  }`}
                >
                  <Icon size={18} strokeWidth={2} className="flex-shrink-0" />
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

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-[var(--hover)]"
      >
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--primary-wash)] text-sm font-semibold text-[var(--primary)]">
          {user.name?.[0]?.toUpperCase() || "A"}
        </div>
        <div className="hidden text-left sm:block">
          <p className="text-sm font-semibold leading-tight text-[var(--ink)]">{user.name}</p>
          <p className="text-xs leading-tight text-[var(--slate-quiet)]">Administrator</p>
        </div>
        <ChevronDown size={16} className="hidden text-[var(--slate-quiet)] sm:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-[var(--shadow-soft)]">
          <Link
            href="/dashboard/account"
            onClick={() => setOpen(false)}
            className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)] sm:min-h-0 sm:py-2"
          >
            <ShieldCheck size={16} /> Account & Security
          </Link>
          <button
            onClick={onLogout}
            className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm font-medium text-[var(--slate)] hover:bg-[var(--hover)] sm:min-h-0 sm:py-2"
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default function DashboardShell({ children }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [user, isLoading, router]);

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

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (search.trim()) router.push(`/dashboard/students?search=${encodeURIComponent(search.trim())}`);
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      {mobileNavOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-shrink-0 -translate-x-full flex-col bg-[var(--sidebar-bg)] transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <Logo size={30} inkClassName="text-white" />
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--sidebar-ink)] hover:bg-[var(--sidebar-hover)] lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mx-4 mt-5 flex items-center gap-2.5 rounded-lg border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] px-3 py-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active-bg)]">
            <School size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white" title={user.school.name}>{user.school.name}</p>
            <p className="text-xs text-[var(--sidebar-ink-muted)]">Admin</p>
          </div>
        </div>

        <NavLinks pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <button
            onClick={handleLogout}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--sidebar-ink)] hover:bg-[var(--sidebar-hover)] hover:text-white"
          >
            <LogOut size={18} /> Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 sm:px-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[var(--slate)] hover:bg-[var(--hover)] lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="lg:hidden"><LogoMark size={26} /></div>
          <form onSubmit={handleSearchSubmit} className="hidden flex-1 sm:block">
            <SearchBar
              placeholder="Search students..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
