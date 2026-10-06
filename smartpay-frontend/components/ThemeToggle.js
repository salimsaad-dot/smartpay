"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Same pattern already proven on Academia Hub: localStorage holds an
// explicit choice once the user makes one; until then, OS preference
// decides. No anti-flash inline script, matching that same project's
// accepted tradeoff — a brief flash of the default theme on first load
// in exchange for not adding a layout-level script.
export function useTheme() {
  const [theme, setThemeState] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem("smartpay-theme");
    const initial = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", initial);
    setThemeState(initial);
  }, []);

  function setTheme(next) {
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("smartpay-theme", next);
    setThemeState(next);
  }

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

export default function ThemeToggle({ className = "" }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[var(--slate-quiet)] hover:bg-[var(--hover)] hover:text-[var(--ink)] ${className}`}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
