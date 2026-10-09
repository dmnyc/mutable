import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/** A clear way back to the pack list from a pack page or the editor. */
export default function BackToPacks() {
  return (
    <Link
      href="/draftable"
      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-800 dark:text-gray-100 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
    >
      <ArrowLeft size={16} />
      All follow packs
    </Link>
  );
}
