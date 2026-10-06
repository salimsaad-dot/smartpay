"use client";

import { CreditCard, Bell, Users, BarChart3 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { IconBadge } from "@/components/ui2";

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
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="hidden flex-col justify-center bg-gradient-to-br from-[var(--primary-wash)] via-[#EAF2FE] to-[var(--card)] px-12 py-16 lg:flex lg:w-1/2 xl:px-20">
        <Logo size={40} showTagline />
        <h1 className="mt-10 text-4xl font-bold leading-tight text-[var(--brand-navy)]">
          Smarter school fee management for a brighter future.
        </h1>
        <p className="mt-4 max-w-md text-[var(--slate)]">
          Streamline your school&apos;s fee collection process, manage payments, send reminders and keep everything in one place.
        </p>
        <div className="mt-10 space-y-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-center gap-4">
              <IconBadge icon={f.icon} tone={f.tone} size={40} />
              <div>
                <p className="font-semibold text-[var(--ink)]">{f.title}</p>
                <p className="text-sm text-[var(--slate-quiet)]">{f.desc}</p>
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
