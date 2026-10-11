import type { Config } from "tailwindcss";

/*
 * Mutable 2.0 token layer.
 *
 * Surfaces and text tiers read CSS variables so light/dark is one class
 * flip (see globals.css). Values are stored as bare channel triplets so
 * Tailwind opacity modifiers work: bg-panel/80, text-mut, border-line/50.
 *
 * Palette rule: same hues as the current app. Dark surfaces stay on the
 * blue-based gray family (gray-900 #111827 / gray-800 #1f2937); light stays
 * gray-50/gray-100. The reskin adds depth and texture, not new hues.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",

        // Surfaces (gradient endpoints live in globals.css as --canvas-a/b, --panel-a/b)
        canvas: "rgb(var(--canvas-a) / <alpha-value>)",
        "canvas-deep": "rgb(var(--canvas-b) / <alpha-value>)",
        panel: "rgb(var(--panel-a) / <alpha-value>)",
        inset: "rgb(var(--panel-inset) / <alpha-value>)",

        // Text tiers: hi = headings/values, mid = body, mut = secondary (neutral surfaces only)
        hi: "rgb(var(--ink-hi) / <alpha-value>)",
        mid: "rgb(var(--ink-mid) / <alpha-value>)",
        mut: "rgb(var(--ink-mut) / <alpha-value>)",

        // Hairlines (decorative container edges; WCAG exempts decorative
        // borders). line-strong is for control boundaries — inputs, selects,
        // outlined buttons — where WCAG 1.4.11 requires 3:1 (it passes
        // against panel surfaces in both themes).
        line: "rgb(var(--line) / 0.10)",
        "line-2": "rgb(var(--line) / 0.18)",
        "line-strong": "rgb(var(--line) / 0.55)",

        // Primary action red (same values as today's bg-red-600 system).
        // Button gradient: DEFAULT -> deep; both pass 4.5:1 with white text.
        primary: {
          DEFAULT: "#dc2626",
          hover: "#b91c1c",
          deep: "#991b1b",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        display: [
          "var(--font-montserrat)",
          "var(--font-inter)",
          "ui-sans-serif",
          "sans-serif",
        ],
      },
      boxShadow: {
        panel:
          "0 24px 48px -24px rgb(2 6 23 / 0.55), 0 2px 10px rgb(2 6 23 / 0.25)",
        "panel-light":
          "0 18px 36px -22px rgb(17 24 39 / 0.35), 0 1px 4px rgb(17 24 39 / 0.08)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        rise: "rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
