import { redirect } from "next/navigation";

// Plebs vs. Zombies spells the route /zombiecheck — keep that spelling
// working as a fallback by redirecting to /zombie-check with the query
// (e.g. ?npub=…) intact.
export default async function ZombieCheckAliasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") qs.set(key, value);
  }
  const query = qs.toString();
  redirect(`/zombie-check${query ? `?${query}` : ""}`);
}
