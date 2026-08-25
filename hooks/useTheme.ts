import { useState, useCallback } from "react";
import { getStoredTheme, setStoredTheme, type Theme } from "@/lib/theme";

// Client hook over the persisted theme preference (see lib/theme.ts).
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  const changeTheme = useCallback((next: Theme) => {
    setStoredTheme(next);
    setTheme(next);
  }, []);

  return [theme, changeTheme] as const;
}
