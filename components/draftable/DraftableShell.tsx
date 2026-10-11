"use client";

import AppShell from "@/components/system/AppShell";

export { useRequestSignIn } from "@/components/system/AppShell";

/** Header, tool nav, and footer shared by every Draftable page. */
export default function DraftableShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell navActive="draftable" width="tool">
      {children}
    </AppShell>
  );
}
