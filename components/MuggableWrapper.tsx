"use client";

import Muggable from "./Muggable";
import AppShell from "@/components/system/AppShell";

interface MuggableWrapperProps {
  initialQuery?: string;
}

export default function MuggableWrapper({ initialQuery }: MuggableWrapperProps) {
  return (
    <AppShell navActive="muggable" width="regular">
      <Muggable initialQuery={initialQuery} />
    </AppShell>
  );
}
