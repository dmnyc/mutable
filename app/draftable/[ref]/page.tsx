import { notFound, redirect } from "next/navigation";
import { parsePackReference, referencePath } from "@/lib/draftable/pack";

/**
 * `/draftable/naddr1…`: open a follow pack from its naddr, the way
 * following.space links to `/naddr1…`. Anything else here is a 404.
 */
export default async function DraftableReferencePage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  let raw = ref;
  try {
    raw = decodeURIComponent(ref);
  } catch {
    // keep it as-is
  }
  const parsed = /^(nostr:)?naddr1/i.test(raw) ? parsePackReference(raw) : null;
  if (!parsed) notFound();
  redirect(referencePath(parsed));
}
