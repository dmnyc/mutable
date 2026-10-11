"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Menu, X } from "lucide-react";

export type SiteNavActive =
  | "myList"
  | "publicLists"
  | "muteuals"
  | "reciprocals"
  | "muteOScope"
  | "backups"
  | "noteNuke"
  | "domainPurge"
  | "purgatory"
  | "decimator"
  | "listCleaner"
  | "snoopable"
  | "clonable"
  | "muggable"
  | "reportable"
  | "redactable"
  | "draftable"
  | "settings";

interface NavItem {
  id: SiteNavActive;
  label: string;
  /** Where the item links on standalone tool pages. */
  href: string;
  /**
   * Dashboard tab id, for items that are tabs rather than routes. On the
   * dashboard those switch tab via onTabChange (no scroll); everywhere
   * else they are plain links, exactly like the DashboardNav they replace.
   */
  dashboardTab?: string;
}

// Order kept identical to the DashboardNav this replaces.
const PRIMARY: NavItem[] = [
  { id: "myList", label: "My Mutes", href: "/dashboard?tab=myList", dashboardTab: "myList" },
  { id: "publicLists", label: "Mute Packs", href: "/dashboard?tab=publicLists", dashboardTab: "publicLists" },
  { id: "muteuals", label: "Muteuals", href: "/dashboard?tab=muteuals", dashboardTab: "muteuals" },
  { id: "reciprocals", label: "Reciprocals", href: "/reciprocals" },
  { id: "muteOScope", label: "Mute-o-Scope", href: "/mute-o-scope" },
  { id: "snoopable", label: "Snoopable", href: "/snoopable" },
  { id: "draftable", label: "Draftable", href: "/draftable" },
  { id: "backups", label: "Backups", href: "/dashboard?tab=backups", dashboardTab: "backups" },
];

const OTHER_STUFF: NavItem[] = [
  { id: "noteNuke", label: "Note Nuke", href: "/note-nuke", dashboardTab: "noteNuke" },
  { id: "domainPurge", label: "Domain Purge", href: "/dashboard?tab=domainPurge", dashboardTab: "domainPurge" },
  { id: "purgatory", label: "Purgatory", href: "/purgatory", dashboardTab: "purgatory" },
  { id: "decimator", label: "Decimator", href: "/decimator" },
  { id: "reportable", label: "Reportable", href: "/reportable" },
  { id: "redactable", label: "Redactable", href: "/redactable" },
  { id: "muggable", label: "Muggable", href: "/muggable" },
  { id: "listCleaner", label: "List Cleaner", href: "/dashboard?tab=listCleaner", dashboardTab: "listCleaner" },
  { id: "clonable", label: "Clonable", href: "/clonable" },
];

const ALL: NavItem[] = [...PRIMARY, ...OTHER_STUFF];

/**
 * The one nav. Desktop tabs with the red active underline, "Other Stuff"
 * dropdown, mobile sheet. `onTabChange` switches it into dashboard mode,
 * where tab items swap views instead of navigating (preserving the
 * no-scroll tab behavior of the old inline dashboard nav).
 */
export default function SiteNav({
  active,
  onTabChange,
  activeLabel,
}: {
  active: SiteNavActive;
  onTabChange?: (tab: string) => void;
  /** Overrides the mobile header label (e.g. "Settings", which has no nav tab). */
  activeLabel?: string;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const otherActive = OTHER_STUFF.some((i) => i.id === active);

  const renderItem = (item: NavItem, mobile: boolean) => {
    const isActive = active === item.id;
    const useTab = onTabChange && item.dashboardTab;
    const base = mobile
      ? "block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors"
      : "py-4 px-2.5 border-b-2 font-semibold text-sm transition-colors";
    const state = isActive
      ? mobile
        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
        : "nav-lamp border-transparent nav-lit"
      : mobile
        ? "text-mid hover:bg-black/5 dark:hover:bg-white/5"
        : "border-transparent text-mut hover:text-hi hover:border-line-2";
    if (useTab) {
      return (
        <button
          key={item.id}
          onClick={() => {
            if (mobile) setMobileOpen(false);
            onTabChange!(item.dashboardTab!);
          }}
          className={`${base} ${state}`}
        >
          {item.label}
        </button>
      );
    }
    return (
      <Link
        key={item.id}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`${base} ${state}`}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      className="glass-header nav-lightbar relative z-40 border-b border-line"
      aria-label="Main"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Desktop */}
        <div className="hidden xl:flex justify-center gap-7">
          {PRIMARY.map((i) => renderItem(i, false))}
          <div className="relative">
            <button
              onClick={() => setToolsOpen(!toolsOpen)}
              onBlur={() => setTimeout(() => setToolsOpen(false), 150)}
              className={`py-4 px-2.5 border-b-2 font-semibold text-sm transition-colors flex items-center gap-1.5 ${
                otherActive
                  ? "nav-lamp border-transparent nav-lit"
                  : "border-transparent text-mut hover:text-hi hover:border-line-2"
              }`}
              aria-expanded={toolsOpen}
            >
              Other Stuff
              <ChevronDown
                size={15}
                className={`transition-transform ${toolsOpen ? "rotate-180" : ""}`}
              />
            </button>
            {toolsOpen && (
              <div className="absolute top-full left-0 mt-1 panel border border-line-2 rounded-xl shadow-panel py-1.5 min-w-[180px] z-50">
                {OTHER_STUFF.map((i) => {
                  const isActive = active === i.id;
                  const cls = `block w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                      : "text-mid hover:bg-black/5 dark:hover:bg-white/5"
                  }`;
                  return i.dashboardTab && onTabChange ? (
                    <button
                      key={i.id}
                      onClick={() => {
                        setToolsOpen(false);
                        onTabChange(i.dashboardTab!);
                      }}
                      className={cls}
                    >
                      {i.label}
                    </button>
                  ) : (
                    <Link
                      key={i.id}
                      href={i.href}
                      onClick={() => setToolsOpen(false)}
                      className={cls}
                    >
                      {i.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Mobile */}
        <div className="xl:hidden">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex items-center justify-between w-full py-3.5"
            aria-expanded={mobileOpen}
          >
            <span className="flex items-center gap-2">
              {mobileOpen ? (
                <X size={22} strokeWidth={2.5} className="text-hi" />
              ) : (
                <Menu size={22} strokeWidth={2.5} className="text-hi" />
              )}
              <span className="text-base font-bold text-hi">Menu</span>
            </span>
            <span className="font-medium text-sm text-mut">
              {activeLabel ?? ALL.find((i) => i.id === active)?.label ?? ""}
            </span>
          </button>

          {mobileOpen && (
            <div className="absolute left-0 right-0 max-h-[calc(100vh-4rem)] overflow-y-auto panel border-t border-line shadow-panel z-50">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
                {PRIMARY.map((i) => renderItem(i, true))}
                <div className="mt-2 border-t border-line pt-2">
                  <p className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-mut">
                    Other Stuff
                  </p>
                  <div className="space-y-1">
                    {OTHER_STUFF.map((i) => renderItem(i, true))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
