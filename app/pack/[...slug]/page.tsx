"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PublicMuteList } from "@/types";
import {
  fetchPublicListByEventId,
  fetchPublicListByDTag,
  DEFAULT_RELAYS,
} from "@/lib/nostr";
import PublicListCard from "@/components/PublicListCard";
import { RefreshCw, LogIn } from "lucide-react";
import AppShell, { useRequestSignIn } from "@/components/system/AppShell";
import { useAuth } from "@/hooks/useAuth";

export default function PackPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string[];
  const { session } = useAuth();

  // Determine if we're using event ID format or author+dTag format
  const isEventIdFormat = slug.length === 1;
  const eventId = isEventIdFormat ? slug[0] : null;
  const author = !isEventIdFormat ? slug[0] : null;
  const dtag = !isEventIdFormat ? slug[1] : null;

  const [pack, setPack] = useState<PublicMuteList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSignIn = useRequestSignIn();

  useEffect(() => {
    const loadPack = async () => {
      try {
        setLoading(true);
        setError(null);

        let fetchedPack: PublicMuteList | null = null;

        if (isEventIdFormat && eventId) {
          console.log("Loading pack with event ID:", eventId);
          fetchedPack = await fetchPublicListByEventId(eventId, DEFAULT_RELAYS);
        } else if (author && dtag) {
          console.log("Loading pack with author:", author, "and d-tag:", dtag);
          fetchedPack = await fetchPublicListByDTag(
            author,
            dtag,
            DEFAULT_RELAYS,
          );
        }

        console.log("Fetched pack:", fetchedPack);

        if (fetchedPack) {
          setPack(fetchedPack);
        } else {
          console.log("Pack not found");
          setError("Pack not found");
        }
      } catch (err) {
        console.error("Failed to load pack:", err);
        setError(err instanceof Error ? err.message : "Failed to load pack");
      } finally {
        setLoading(false);
      }
    };

    if ((isEventIdFormat && eventId) || (author && dtag)) {
      loadPack();
    }
  }, [isEventIdFormat, eventId, author, dtag]);

  if (loading) {
    return (
      <AppShell navActive="draftable" hideNav width="regular">
        <main className="py-8">
          <div className="panel relative rounded-xl border border-line shadow-panel p-12 text-center">
            <RefreshCw
              className="animate-spin mx-auto mb-3 text-gray-400"
              size={32}
            />
            <p className="text-mid">Loading pack...</p>
          </div>
        </main>
      </AppShell>
    );
  }

  if (error || !pack) {
    return (
      <AppShell navActive="draftable" hideNav width="regular">
        <main className="py-8">
          <div className="panel relative rounded-xl border border-line shadow-panel p-12 text-center">
            <p className="text-red-600 dark:text-red-400 mb-4">
              {error || "Pack not found"}
            </p>
            <button
              onClick={requestSignIn}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] font-semibold shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 transition-all"
            >
              <LogIn size={18} />
              <span>Sign In to Import</span>
            </button>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell navActive="draftable" hideNav width="regular">
      <main className="py-8">
        <PublicListCard list={pack} isOwner={false} />

        {!session && (
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>To import this pack:</strong> Sign in to Mutable and click
              the &quot;Add to My Mute List&quot; button above.
            </p>
          </div>
        )}
      </main>
    </AppShell>
  );
}
