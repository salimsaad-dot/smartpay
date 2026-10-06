// Recreated from the redesign mockups (no original vector asset exists) —
// a graduation cap sitting on a payment card, reading clearly as "school
// fees" at the small sizes this actually renders at (a 32-40px header mark).
export function LogoMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      {/* Card body */}
      <rect x="4" y="16" width="32" height="20" rx="5" fill="var(--brand-green)" />
      <rect x="4" y="21" width="32" height="5" fill="#FFFFFF" fillOpacity="0.35" />
      <rect x="9" y="30" width="10" height="2.5" rx="1.25" fill="#FFFFFF" fillOpacity="0.7" />
      {/* Graduation cap */}
      <path d="M20 3 L37 11 L20 19 L3 11 Z" fill="var(--brand-navy)" />
      <path d="M12 14.5 V21 C12 23 16 24.5 20 24.5 C24 24.5 28 23 28 21 V14.5 L20 18.5 Z" fill="var(--brand-navy)" />
      <circle cx="35" cy="11" r="1.6" fill="var(--brand-navy)" />
      <line x1="35" y1="11" x2="35" y2="19" stroke="var(--brand-navy)" strokeWidth="1.4" />
    </svg>
  );
}

export function Logo({ size = 32, showTagline = false, inkClassName = "text-[var(--brand-navy)]" }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <div>
        <span className={`text-lg font-bold leading-none ${inkClassName}`}>
          Smart<span className="text-[var(--brand-green)]">Pay</span>
        </span>
        {showTagline && <p className="mt-0.5 text-[11px] leading-none text-[var(--slate-quiet)]">School fees, simplified.</p>}
      </div>
    </div>
  );
}
