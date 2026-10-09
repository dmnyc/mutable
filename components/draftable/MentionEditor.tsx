"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nip19 } from "nostr-tools";
import { getDisplayName } from "@/lib/utils/format";
import { SharePart, profileRefs } from "@/lib/draftable/share";
import { useProfiles } from "./useProfiles";

const PILL_CLASS =
  "inline-block px-1.5 mx-px rounded-md bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 font-medium cursor-default";

function makePill(pubkey: string, name: string): HTMLSpanElement {
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.pubkey = pubkey;
  pill.dataset.name = name;
  pill.className = PILL_CLASS;
  pill.textContent = `@${name}`;
  return pill;
}

/**
 * The editor's DOM as note text. Pills become nostr: mentions; line breaks
 * come from text, <br>, or the <div>s browsers add on Enter.
 */
function serialize(root: HTMLElement): {
  content: string;
  names: Map<string, string>;
} {
  const names = new Map<string, string>();
  let content = "";
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      content += node.textContent ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const { pubkey, name } = node.dataset;
    if (pubkey) {
      content += `nostr:${nip19.npubEncode(pubkey)}`;
      if (name) names.set(pubkey, name);
      return;
    }
    if (node.tagName === "BR") {
      content += "\n";
      return;
    }
    if (
      (node.tagName === "DIV" || node.tagName === "P") &&
      content.length > 0 &&
      !content.endsWith("\n")
    ) {
      content += "\n";
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return { content, names };
}

/**
 * A note composer where mentions are atomic pills, like a client's: the
 * pill can be deleted whole but never half-edited, so a mention can't break.
 * Pasted npubs (with or without nostr:) turn into pills once their names load.
 */
export default function MentionEditor({
  initial,
  resetKey,
  relays,
  onChange,
}: {
  initial: SharePart[];
  /** Change to rebuild the editor from `initial`. */
  resetKey: number;
  relays: string[];
  onChange: (content: string, names: Map<string, string>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const [pastedPubkeys, setPastedPubkeys] = useState<string[]>([]);

  const emit = () => {
    const root = ref.current;
    if (!root) return;
    const { content, names } = serialize(root);
    onChangeRef.current(content, names);
    // Bare npubs in the text, waiting for a name to become pills.
    const refs = profileRefs(textOnly(root));
    setPastedPubkeys((prev) => {
      const next = Array.from(new Set(refs.map((r) => r.pubkey)));
      return next.join() === prev.join() ? prev : next;
    });
  };

  // Build (or rebuild, on reset) from the prewritten message.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.replaceChildren(
      ...initial.map((part) =>
        typeof part === "string"
          ? document.createTextNode(part)
          : makePill(part.pubkey, part.name),
      ),
    );
    emit();
    // initial is stable for a modal's life; resetKey drives rebuilds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const profiles = useProfiles(pastedPubkeys, relays);
  const resolvedKey = useMemo(
    () =>
      pastedPubkeys.filter((pk) => getDisplayName(profiles.get(pk), "")).join(),
    [pastedPubkeys, profiles],
  );

  // Swap pasted npubs for pills once names are known.
  useEffect(() => {
    const root = ref.current;
    if (!root || !resolvedKey) return;
    let changed = false;
    const selection = window.getSelection();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (const node of textNodes) {
      const text = node.textContent ?? "";
      const refs = profileRefs(text).filter((r) =>
        getDisplayName(profiles.get(r.pubkey), ""),
      );
      if (refs.length === 0) continue;
      const caretHere = selection?.anchorNode === node;
      const fragment = document.createDocumentFragment();
      let rest = text;
      let lastPill: HTMLSpanElement | null = null;
      for (const { ref: token, pubkey } of refs) {
        const at = rest.indexOf(token);
        if (at < 0) continue;
        fragment.append(rest.slice(0, at));
        lastPill = makePill(pubkey, getDisplayName(profiles.get(pubkey), ""));
        fragment.append(lastPill);
        rest = rest.slice(at + token.length);
      }
      const tail = document.createTextNode(rest || " ");
      fragment.append(tail);
      node.replaceWith(fragment);
      changed = true;
      if (caretHere && selection) {
        const range = document.createRange();
        range.setStart(tail, rest ? 0 : 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    if (changed) emit();
    // emit reads the DOM; profiles drive this through resolvedKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey]);

  return (
    <div
      ref={ref}
      id="draftable-share-text"
      role="textbox"
      aria-multiline="true"
      aria-label="Message"
      contentEditable
      suppressContentEditableWarning
      onInput={emit}
      onKeyDown={(e) => {
        // A plain line break, not the <div> browsers add on Enter.
        if (e.key === "Enter") {
          e.preventDefault();
          document.execCommand("insertLineBreak");
        }
      }}
      onPaste={(e) => {
        // Paste as plain text so pages' markup never lands in a note.
        e.preventDefault();
        document.execCommand(
          "insertText",
          false,
          e.clipboardData.getData("text/plain"),
        );
      }}
      className="min-h-[9rem] w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white leading-relaxed whitespace-pre-wrap break-words focus:outline-none focus:ring-2 focus:ring-[#556b2f] focus:border-transparent"
    />
  );
}

/** Text outside pills, for spotting pasted npubs. */
function textOnly(root: HTMLElement): string {
  let out = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) out += `${walker.currentNode.textContent} `;
  return out;
}
