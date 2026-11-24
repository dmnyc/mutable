// Turns a note's text into what a client renders: styled segments, with the
// pieces that become cards (a quoted note, inline images) lifted out. Pure so
// the spacing rules can be tested.

import { NoteSegment, noteSegments } from "@/lib/draftable/share";

const IMAGE_URL = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i;
const QUOTE_REF = /nostr:(?:nevent|note)1[02-9ac-hj-np-z]+/gi;

export interface PreviewParts {
  segments: NoteSegment[];
  /** Image links found in the text, shown as pictures instead. */
  inlineImages: string[];
}

export function buildPreviewParts(
  content: string,
  { quoted = false }: { quoted?: boolean } = {},
): PreviewParts {
  // A quoted note renders as a card, not as a raw nevent string.
  const text = quoted ? content.replace(QUOTE_REF, "") : content;
  const inlineImages: string[] = [];
  const segments = noteSegments(text).flatMap((segment) => {
    if (segment.type === "url" && IMAGE_URL.test(segment.value)) {
      inlineImages.push(segment.value);
      return [];
    }
    return [segment];
  });

  // What's left behind by a lifted-out quote or image is blank lines at the
  // end of the text. The card brings its own margin, so trailing whitespace
  // would double the gap above it.
  while (segments.length) {
    const last = segments[segments.length - 1];
    if (last.type !== "text") break;
    const trimmed = last.value.trimEnd();
    if (trimmed) {
      last.value = trimmed;
      break;
    }
    segments.pop();
  }

  return { segments, inlineImages };
}
