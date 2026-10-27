import { useEffect } from "react";

// Ref-counted body scroll lock. Every modal takes a lock while open and
// releases it on close, so stacked modals only unlock when the last one
// closes. Compensates for the disappearing scrollbar so the page doesn't
// jump sideways when the lock engages.
let locks = 0;
let previousOverflow = "";
let previousPaddingRight = "";

export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    locks += 1;
    if (locks === 1) {
      previousOverflow = document.body.style.overflow;
      previousPaddingRight = document.body.style.paddingRight;
      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
    }
    return () => {
      locks -= 1;
      if (locks === 0) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
    };
  }, [active]);
}
