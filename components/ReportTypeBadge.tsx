'use client';

// Shared so the report rows and the report detail modal can never drift
// apart on NIP-56 type labels or colors.

export const REPORT_TYPE_LABELS: Record<string, string> = {
  nudity: "Nudity",
  malware: "Malware",
  profanity: "Profanity",
  illegal: "Illegal",
  spam: "Spam",
  impersonation: "Impersonation",
  other: "Other",
};

export const REPORT_TYPE_COLORS: Record<string, string> = {
  nudity: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  malware: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  profanity:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  illegal: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  spam: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  impersonation:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};

export default function ReportTypeBadge({ type }: { type?: string }) {
  const key = type?.toLowerCase() || "other";
  const label = REPORT_TYPE_LABELS[key] || type || "Other";
  const colors = REPORT_TYPE_COLORS[key] || REPORT_TYPE_COLORS.other;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}
    >
      {label}
    </span>
  );
}
