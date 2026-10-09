import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import DraftableShell from "@/components/draftable/DraftableShell";
import DraftablePack from "@/components/draftable/DraftablePack";
import {
  cleanRelayHints,
  conscriptCount,
  parsePackReference,
  referencePath,
  resolvePubkey,
} from "@/lib/draftable/pack";
import { fetchPackForPreview } from "@/lib/draftable/server";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** `/draftable/d/naddr1…` is a pasted naddr: send it to the pack's URL. */
function redirectIfNaddr(dTag: string) {
  if (!/^(nostr:)?naddr1/i.test(dTag)) return;
  const ref = parsePackReference(dTag);
  if (ref) redirect(referencePath(ref));
}

function clean(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const dTag = decodeId((await params).id);
  redirectIfNaddr(dTag);
  const query = await searchParams;
  const author = resolvePubkey(typeof query.p === "string" ? query.p : null);

  const pack = await fetchPackForPreview(dTag, author ?? undefined);
  const card = `/draftable/card?d=${encodeURIComponent(dTag)}${
    author ? `&p=${author}` : ""
  }`;

  const title = pack
    ? `${clean(pack.name, 80)} — a follow pack on Draftable`
    : "A follow pack on Draftable";
  const description = pack
    ? pack.description
      ? clean(pack.description, 200)
      : `${conscriptCount(pack.members.length)} drafted into this Nostr follow pack. None of them can leave.`
    : "A Nostr follow pack. Everyone in it was drafted, and nobody can leave.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: card, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [card],
    },
  };
}

export default async function DraftablePackPage({ params, searchParams }: Props) {
  const dTag = decodeId((await params).id);
  redirectIfNaddr(dTag);
  const query = await searchParams;
  const author = resolvePubkey(typeof query.p === "string" ? query.p : null);
  // Relay hints from an naddr. Only the browser follows them; the server-side
  // preview fetch sticks to its own relays.
  const relayHints = cleanRelayHints([query.r ?? []].flat());

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <DraftableShell>
        <DraftablePack
          dTag={dTag}
          author={author ?? undefined}
          relayHints={relayHints}
          justPublished={query.published === "1"}
        />
      </DraftableShell>
    </Suspense>
  );
}
