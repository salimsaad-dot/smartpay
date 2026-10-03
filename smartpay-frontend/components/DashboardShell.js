"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/academic-setup", label: "Academic Setup" },
  { href: "/dashboard/classes", label: "Classes" },
  { href: "/dashboard/students", label: "Students" },
  { href: "/dashboard/parents", label: "Parents" },
];

export default function DashboardShell({ children }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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
    <div className="flex min-h-screen">
      <aside className="w-56 flex-shrink-0 border-r border-[var(--border)] bg-white p-4">
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
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
