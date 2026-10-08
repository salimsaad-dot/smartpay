"use client";

import { CreditCard, Bell, Users, BarChart3 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { IconBadge } from "@/components/ui2";
import ThemeToggle from "@/components/ThemeToggle";

const FEATURES = [
  { icon: CreditCard, tone: "success", title: "Secure Online Payments", desc: "Fast, safe and reliable" },
  { icon: Bell, tone: "violet", title: "Automated Reminders", desc: "Reduce arrears, improve collection" },
  { icon: Users, tone: "info", title: "Student & Parent Management", desc: "Keep your school community connected" },
  { icon: BarChart3, tone: "info", title: "Insightful Reports", desc: "Make better financial decisions" },
];

// Shared shell for Login and Register — a hero panel (hidden on phones)
// plus a centered card for the form itself.
export function AuthSplitLayout({ children }) {
  return (
    <div className="relative flex min-h-screen flex-col lg:flex-row">
      <ThemeToggle className="absolute right-4 top-4 z-10 bg-[var(--card)] shadow-[var(--shadow-soft)]" />
      <div
        className="relative hidden flex-col justify-center overflow-hidden bg-cover bg-center px-12 py-16 lg:flex lg:w-1/2 xl:px-20"
        style={{
          // --brand-navy/--slate-quiet are scoped (not overridden globally)
          // so Logo/LogoMark — shared components also used elsewhere in
          // light and dark mode — read as light-on-dark here without
          // needing a variant prop threaded through them. This panel is a
          // photo background now, not the app's normal themed surface, so
          // it stays legible the same way regardless of site theme.
          "--brand-navy": "#FFFFFF",
          "--slate-quiet": "rgba(255, 255, 255, 0.75)",
          backgroundImage: "linear-gradient(135deg, rgba(15, 23, 42, 0.82), rgba(15, 23, 42, 0.60)), url('/login-hero.jpg')",
        }}
      >
        <Logo size={40} showTagline />
        <h1 className="mt-10 text-4xl font-bold leading-tight text-white">
          Smarter school fee management for a brighter future.
        </h1>
        <p className="mt-4 max-w-md text-white/80">
          Streamline your school&apos;s fee collection process, manage payments, send reminders and keep everything in one place.
        </p>
        <div className="mt-10 space-y-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-center gap-4">
              <IconBadge icon={f.icon} tone={f.tone} size={40} />
              <div>
                <p className="font-semibold text-white">{f.title}</p>
                <p className="text-sm text-white/75">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-[var(--bg)] px-4 py-10 sm:px-6">
        {children}
      </div>
    </div>
  );
}
