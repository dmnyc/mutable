"use client";

import NoteNuke from "./NoteNuke";
import AppShell from "@/components/system/AppShell";

export default function NoteNukeWrapper() {
  return (
    <AppShell navActive="noteNuke" width="tool">
      <NoteNuke />
    </AppShell>
  );
}
