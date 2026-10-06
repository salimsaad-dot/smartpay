"use client";

import { Search } from "lucide-react";

// Six-color rotation so the same name always lands on the same color within
// one render, without needing a hash stored anywhere.
const AVATAR_COLORS = [1, 2, 3, 4, 5, 6];
function colorIndexFor(name) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export function Avatar({ name, size = 36 }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const idx = colorIndexFor(name || "?");
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: `var(--avatar-${idx}-wash)`,
        color: `var(--avatar-${idx})`,
      }}
      aria-hidden="true"
    >
      {initials || "?"}
    </div>
  );
}

const BADGE_TONES2 = {
  success: "bg-[var(--success-wash)] text-[var(--success)]",
  danger: "bg-[var(--danger-wash)] text-[var(--danger)]",
  warning: "bg-[var(--warning-wash)] text-[var(--warning)]",
  info: "bg-[var(--primary-wash)] text-[var(--primary)]",
  violet: "bg-[var(--violet-wash)] text-[var(--violet)]",
  neutral: "bg-[var(--hover)] text-[var(--slate-quiet)]",
};

export function Badge2({ tone = "neutral", children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${BADGE_TONES2[tone]}`}>
      {children}
    </span>
  );
}

export function Card2({ className = "", children }) {
  return (
    <div className={`rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-soft)] ${className}`}>
      {children}
    </div>
  );
}

const ICON_BADGE_TONES = {
  info: "bg-[var(--primary-wash)] text-[var(--primary)]",
  success: "bg-[var(--success-wash)] text-[var(--success)]",
  danger: "bg-[var(--danger-wash)] text-[var(--danger)]",
  violet: "bg-[var(--violet-wash)] text-[var(--violet)]",
};

export function IconBadge({ icon: Icon, tone = "info", size = 44 }) {
  return (
    <div className={`flex flex-shrink-0 items-center justify-center rounded-xl ${ICON_BADGE_TONES[tone]}`} style={{ width: size, height: size }}>
      <Icon size={size * 0.5} strokeWidth={2} />
    </div>
  );
}

// A dashboard stat card: icon badge + label + headline value + a small
// trend/context line underneath.
export function StatCard({ icon, tone = "info", label, value, hint, hintTone }) {
  return (
    <Card2 className="p-5">
      <div className="flex items-start justify-between">
        <IconBadge icon={icon} tone={tone} />
      </div>
      <p className="mt-3 text-xs font-medium text-[var(--slate-quiet)]">{label}</p>
      {value === null ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-[var(--hover)]" aria-hidden="true" />
      ) : (
        <p className="mt-1 text-2xl font-bold text-[var(--ink)]">{value}</p>
      )}
      {hint && <p className={`mt-1 text-xs ${hintTone === "danger" ? "text-[var(--danger)]" : "text-[var(--slate-quiet)]"}`}>{hint}</p>}
    </Card2>
  );
}

export function Button2({ variant = "primary", size = "md", className = "", ...props }) {
  const variants = {
    primary: "bg-[var(--primary)] text-white hover:bg-[var(--primary-bright)]",
    secondary: "border border-[var(--border)] bg-[var(--card)] text-[var(--slate)] hover:bg-[var(--hover)]",
    ghost: "text-[var(--slate)] hover:bg-[var(--hover)]",
  };
  const sizes = {
    md: "px-4 py-2.5 text-sm",
    sm: "px-3 py-2 text-xs",
  };
  return (
    <button
      {...props}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-60 sm:min-h-0 ${variants[variant]} ${sizes[size]} ${className}`}
    />
  );
}

export function SearchBar({ placeholder = "Search...", value, onChange, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--slate-quiet)]" />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--hover)] py-2.5 pl-9 pr-3 text-sm focus:border-[var(--primary)] focus:bg-[var(--card)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
      />
    </div>
  );
}
