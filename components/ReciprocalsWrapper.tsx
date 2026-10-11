"use client";

import Reciprocals from "./Reciprocals";
import AppShell from "@/components/system/AppShell";

export default function ReciprocalsWrapper() {
  return (
    <AppShell navActive="reciprocals" width="tool">
      <Reciprocals />
    </AppShell>
  );
}
