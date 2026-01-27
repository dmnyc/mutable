"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, X, Menu } from "lucide-react";

type ActivePage =
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
  | "settings";

interface DashboardNavProps {
  activePage: ActivePage;
}

// Tools that go in the "Other Stuff" dropdown
const toolPages: ActivePage[] = [
  "noteNuke",
  "domainPurge",
  "purgatory",
  "decimator",
  "listCleaner",
];

// Map page IDs to display names
const pageNames: Record<ActivePage, string> = {
  myList: "My Mutes",
  publicLists: "Mute Packs",
  muteuals: "Muteuals",
  reciprocals: "Reciprocals",
  muteOScope: "Mute-o-Scope",
  backups: "Backups",
  noteNuke: "Note Nuke",
  domainPurge: "Domain Purge",
  purgatory: "Purgatory",
  decimator: "Decimator",
  listCleaner: "List Cleaner",
  settings: "Settings",
};

// Map page IDs to URLs
const pageUrls: Record<ActivePage, string> = {
  myList: "/dashboard?tab=myList",
  publicLists: "/dashboard?tab=publicLists",
  muteuals: "/dashboard?tab=muteuals",
  reciprocals: "/dashboard?tab=reciprocals",
  muteOScope: "/mute-o-scope",
  backups: "/dashboard?tab=backups",
  noteNuke: "/note-nuke",
  domainPurge: "/dashboard?tab=domainPurge",
  purgatory: "/purgatory",
  decimator: "/dashboard?tab=decimator",
  listCleaner: "/dashboard?tab=listCleaner",
  settings: "/dashboard?tab=settings",
};

export default function DashboardNav({ activePage }: DashboardNavProps) {
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  const isToolTabActive = toolPages.includes(activePage);

  // Primary nav items (shown inline)
  const primaryPages: ActivePage[] = [
    "myList",
    "publicLists",
    "muteuals",
    "reciprocals",
    "muteOScope",
    "backups",
  ];

  return (
    <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Desktop Navigation */}
        <div className="hidden xl:flex justify-center space-x-6">
          {primaryPages.map((page) => (
            <Link
              key={page}
              href={pageUrls[page]}
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activePage === page
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              {pageNames[page]}
            </Link>
          ))}

          {/* Other Stuff Dropdown */}
          <div className="relative">
            <button
              onClick={() => setToolsDropdownOpen(!toolsDropdownOpen)}
              onBlur={() => setTimeout(() => setToolsDropdownOpen(false), 150)}
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors flex items-center gap-1 ${
                isToolTabActive
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Other Stuff
              <ChevronDown
                size={16}
                className={`transition-transform ${toolsDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {toolsDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 min-w-[180px] z-50">
                {toolPages.map((page) => (
                  <Link
                    key={page}
                    href={pageUrls[page]}
                    onClick={() => setToolsDropdownOpen(false)}
                    className={`block w-full text-left px-4 py-2.5 text-base transition-colors ${
                      activePage === page
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {pageNames[page]}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="xl:hidden">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex items-center justify-between w-full py-4"
          >
            <span className="font-semibold text-base text-gray-900 dark:text-white">
              {pageNames[activePage]}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-600 dark:text-gray-400">
                Menu
              </span>
              {mobileMenuOpen ? (
                <X
                  size={20}
                  strokeWidth={2.5}
                  className="text-gray-900 dark:text-white"
                />
              ) : (
                <Menu
                  size={20}
                  strokeWidth={2.5}
                  className="text-gray-900 dark:text-white"
                />
              )}
            </div>
          </button>

          {/* Mobile Dropdown Menu */}
          {mobileMenuOpen && (
            <div className="absolute left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-50">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
                {/* Primary pages */}
                {primaryPages.map((page) => (
                  <Link
                    key={page}
                    href={pageUrls[page]}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activePage === page
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    {pageNames[page]}
                  </Link>
                ))}

                {/* Other Stuff Accordion */}
                <div className="mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
                  <button
                    onClick={() => setMobileToolsOpen(!mobileToolsOpen)}
                    className={`flex items-center justify-between w-full py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      isToolTabActive
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <span>Other Stuff</span>
                    <ChevronDown
                      size={16}
                      className={`transition-transform ${mobileToolsOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {/* Tool pages nested under accordion */}
                  {mobileToolsOpen && (
                    <div className="ml-4 mt-1 space-y-1">
                      {toolPages.map((page) => (
                        <Link
                          key={page}
                          href={pageUrls[page]}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`block w-full text-left py-2.5 px-4 rounded-lg font-medium text-sm transition-colors ${
                            activePage === page
                              ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          {pageNames[page]}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
