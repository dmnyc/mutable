"use client";

import Snoopable from "./Snoopable";
import AppShell from "@/components/system/AppShell";

export default function SnoopableWrapper() {
  return (
    <AppShell navActive="snoopable" width="tool">
      <Snoopable />
    </AppShell>
  );
}
