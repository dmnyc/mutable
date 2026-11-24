// Guards against modals that render off-center or confined to a column.
//
// `position: fixed` is only viewport-relative while no ancestor is a
// containing block. A transformed ancestor (including one whose transform
// animation is filled forwards, like <main class="animate-rise"> used to be)
// turns `fixed inset-0` into "fill that ancestor", so the overlay covers one
// column and the dialog lands wherever that box's center is.
//
// Two defenses, both enforced here:
//   1. Overlays render through createPortal(…, document.body), so no
//      ancestor can contain them.
//   2. No transform-touching animation uses a forward fill-mode, so page
//      wrappers don't become containing blocks after the animation ends.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "@/tailwind.config";

const ROOT = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// Files allowed to use `fixed inset-0` without a portal, with the reason.
// Add to this only for non-modal helpers; anything dialog-like must portal.
const NO_PORTAL_ALLOWED: Record<string, string> = {
  "components/BackupRestore.tsx":
    "transparent click-away catcher for a dropdown menu, not a dialog",
};

describe("modal containment", () => {
  it("renders every fixed inset-0 overlay through a portal", () => {
    const offenders = ["components", "app"]
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .map((file) => path.relative(ROOT, file))
      .filter((file) => {
        const src = readFileSync(path.join(ROOT, file), "utf8");
        return /fixed inset-0/.test(src) && !/createPortal\(/.test(src);
      })
      .filter((file) => !(file in NO_PORTAL_ALLOWED));

    expect(
      offenders,
      "These files render a `fixed inset-0` overlay without createPortal(…, document.body). " +
        "Inside a transformed ancestor it fills that ancestor instead of the viewport. " +
        "Wrap the overlay in createPortal, or add a justified entry to NO_PORTAL_ALLOWED.",
    ).toEqual([]);
  });

  it("does not forward-fill transform animations in the Tailwind config", () => {
    const extend = (config.theme?.extend ?? {}) as {
      keyframes?: Record<string, Record<string, Record<string, string>>>;
      animation?: Record<string, string>;
    };
    const containing =
      /^(transform|translate|scale|rotate|filter|backdrop-filter|perspective|will-change)$/;

    const bad = Object.entries(extend.animation ?? {})
      .filter(([name, value]) => {
        const frames = extend.keyframes?.[name] ?? {};
        const touchesContainingProps = Object.values(frames).some((frame) =>
          Object.keys(frame).some((prop) => containing.test(prop)),
        );
        const forwardFill = /\b(both|forwards)\b/.test(value);
        return touchesContainingProps && forwardFill;
      })
      .map(([name]) => name);

    expect(
      bad,
      "Use `backwards` (not `both`/`forwards`) for animations that touch transform: " +
        "a forward fill keeps the element a containing block for fixed descendants.",
    ).toEqual([]);
  });

  it("does not forward-fill animations in globals.css", () => {
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const hits = css
      .split("\n")
      .filter((line) =>
        /animation(-fill-mode)?\s*:[^;]*\b(both|forwards)\b/.test(line),
      );
    expect(hits).toEqual([]);
  });
});
