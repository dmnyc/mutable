"use client";

import Clonable from "./Clonable";
import AppShell from "@/components/system/AppShell";

export default function ClonableWrapper() {
  return (
    <AppShell navActive="clonable" width="narrow">
      <Clonable />
    </AppShell>
  );
}
