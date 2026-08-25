// Theme handling ported from Ghostr's settings store: a persisted
// light/dark/system preference applied via the `dark` class on <html>,
// with Tailwind in `darkMode: ["class"]` mode. Deliberately free of React
// imports so the server-rendered root layout can use themeInitScript.

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "mutable-theme";

// Runs before first paint (injected by the root layout) so SSR output never
// flashes the wrong theme. Kept in sync with applyTheme() below.
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;d?c.add('dark'):c.remove('dark')}catch(e){}})()`;

export function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
