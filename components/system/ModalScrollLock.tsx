"use client";

import { useEffect } from "react";

// App-wide scroll lock: while any modal backdrop is in the DOM, body
// scrolling is disabled. Mounted once from the root layout — modal
// components need no code of their own.
//
// The selector matches the two backdrop patterns used in this app
// (`.fixed.inset-0` and the spelled-out variant). Always-mounted fixed
// elements (ambient backdrop, sticky headers) don't match, so the lock
// only engages for things that are actually rendered.
const MODAL_SELECTOR =
  ".fixed.inset-0, .fixed.top-0.left-0.right-0.bottom-0";

let locks = 0;
let previousOverflow = "";
let previousPaddingRight = "";

function takeLock(): void {
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
}

function releaseLock(): void {
  locks -= 1;
  if (locks <= 0) {
    locks = 0;
    document.body.style.overflow = previousOverflow;
    document.body.style.paddingRight = previousPaddingRight;
  }
}

export default function ModalScrollLock(): null {
  useEffect(() => {
    const sync = () => {
      const open = document.querySelectorAll(MODAL_SELECTOR).length > 0;
      if (open) {
        if (locks === 0) takeLock();
      } else if (locks > 0) {
        releaseLock();
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (locks > 0) releaseLock();
    };
  }, []);

  return null;
}
