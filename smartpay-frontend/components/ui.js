"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";

// Shared form styling, so every input on every page looks and focuses the same.
export const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";
export const labelClass = "mb-1 block text-xs font-medium text-[var(--slate-quiet)]";

const BUTTON_VARIANTS = {
  primary: "bg-[var(--primary)] text-white hover:bg-[var(--primary-bright)]",
  secondary: "border border-[var(--border)] bg-white text-[var(--slate)] hover:bg-[var(--hover)]",
  danger: "bg-[var(--danger)] text-white hover:opacity-90",
};

// Buttons meet the 44px touch target on phones and shrink back on larger screens.
export function Button({ variant = "primary", type = "button", className = "", ...props }) {
  return (
    <button
      {...props}
      type={type}
      className={`inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 sm:min-h-0 ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

// Small inline action, used inside table cells and cards.
export function LinkButton({ className = "", ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-[44px] items-center text-xs font-semibold text-[var(--primary)] hover:underline disabled:opacity-60 sm:min-h-0 ${className}`}
    />
  );
}

export function PageHeader({ title, description, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{title}</h1>
        {description && <p className="mt-1 text-sm text-[var(--slate-quiet)]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({ title, action, className = "", children }) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)] ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        {action && (
          <Link href={action.href} className="flex min-h-[44px] items-center text-sm font-medium text-[var(--primary)] hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const TONE_TEXT = {
  default: "text-[var(--ink)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--warning)]",
  danger: "text-[var(--danger)]",
};

export function AmountDisplay({ amount, currency, tone = "default", size = "base" }) {
  const sizeClass = {
    base: "text-sm font-semibold",
    lg: "text-2xl font-semibold",
    xl: "text-3xl font-semibold",
  }[size];
  return <span className={`break-words ${sizeClass} ${TONE_TEXT[tone]}`}>{formatMoney(amount, currency)}</span>;
}

// A metric card. `featured` gives the headline number the most weight on the page.
export function MetricCard({ label, value, hint, tone = "default", featured = false }) {
  const cardClass = featured
    ? "border-[var(--danger)]/30 bg-[var(--danger-wash)] sm:col-span-2 xl:col-span-1"
    : "border-[var(--border)] bg-[var(--card)]";
  return (
    <div className={`rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-card)] ${cardClass}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--slate-quiet)]">{label}</p>
      {value === null ? (
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-[var(--hover)]" aria-hidden="true" />
      ) : (
        <p className={`mt-2 break-words font-semibold ${featured ? "text-3xl" : "text-xl"} ${TONE_TEXT[tone]}`}>{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-[var(--slate-quiet)]">{hint}</p>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-[var(--hover)] text-[var(--slate-quiet)]",
  success: "bg-[var(--success-wash)] text-[var(--success)]",
  warning: "bg-[var(--warning-wash)] text-[var(--warning)]",
  danger: "bg-[var(--danger-wash)] text-[var(--danger)]",
};

export function StatusBadge({ tone = "neutral", children }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${BADGE_TONES[tone]}`}>{children}</span>;
}

// Maps the backend's status words to a badge tone. Covers invoices, payments,
// SMS deliveries, and scheduled jobs in one place, so they read consistently.
export function statusTone(status) {
  if (["paid", "success", "completed", "sent", "delivered", "active"].includes(status)) return "success";
  if (["unpaid", "failed"].includes(status)) return "danger";
  if (["partially_paid", "running", "pending", "initiated"].includes(status)) return "warning";
  return "neutral";
}

export function EmptyState({ children }) {
  return <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-sm text-[var(--slate-quiet)]">{children}</p>;
}

export function LoadingSkeleton({ lines = 2 }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-4 animate-pulse rounded bg-[var(--hover)] ${i % 2 ? "w-1/2" : "w-3/4"}`} />
      ))}
    </div>
  );
}

export function ErrorState({ message }) {
  return <p role="alert" className="rounded-lg bg-[var(--danger-wash)] p-4 text-sm text-[var(--danger)]">{message}</p>;
}

// A stacked card for phone widths, where a table row would need horizontal scrolling.
export function MobileRecordCard({ children }) {
  return <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-card)]">{children}</div>;
}

// Dialog with Escape to close. Clicking the backdrop does NOT close it, so a
// half-typed payment or reminder is never lost to a stray tap.
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, description, onClose, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    // Move focus into the dialog on open, and give it back to whatever
    // triggered the dialog on close — a screen-reader/keyboard user should
    // never be left on a background element they can no longer see past
    // the overlay, nor lose their place once the dialog goes away.
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const firstField = dialog?.querySelector(FOCUSABLE_SELECTOR);
    (firstField || dialog)?.focus();

    function onKey(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 shadow-xl outline-none">
        <h2 id={titleId} className="text-lg font-semibold text-[var(--ink)]">{title}</h2>
        {description && <p className="mt-1 text-sm text-[var(--slate-quiet)]">{description}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

const TOAST_TONES = {
  success: "bg-[var(--ink)]",
  danger: "bg-[var(--danger)]",
};

// A page-local toast, not a global provider — this app has one toast
// visible at a time per page, triggered by a single financial action, so a
// queue/context system would be more machinery than the actual need.
// Usage: const { toast, showToast } = useToast(); then <Toast {...toast} />.
export function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((message, tone = "success") => {
    clearTimeout(timerRef.current);
    setToast({ message, tone });
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { toast, showToast, dismissToast: () => setToast(null) };
}

export function Toast({ message, tone = "success", onDismiss }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:right-6"
    >
      <div className={`flex max-w-sm items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-xl ${TOAST_TONES[tone]}`}>
        <span>{message}</span>
        <button onClick={onDismiss} aria-label="Dismiss notification" className="text-white/70 hover:text-white">✕</button>
      </div>
    </div>
  );
}
