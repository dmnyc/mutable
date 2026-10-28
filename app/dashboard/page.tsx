"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";
import MyMuteList from "@/components/MyMuteList";
import PublicLists from "@/components/PublicLists";
import Muteuals from "@/components/Muteuals";
import Reciprocals from "@/components/Reciprocals";
import Decimator from "@/components/Decimator";
import Backups from "@/components/Backups";
import Settings from "@/components/Settings";
import ListCleaner from "@/components/ListCleaner";
import DomainPurge from "@/components/DomainPurge";
import Purgatory from "@/components/Purgatory";
import NoteNuke from "@/components/NoteNuke";
import Snoopable from "@/components/Snoopable";
import Clonable from "@/components/Clonable";
import OnboardingModal from "@/components/OnboardingModal";
import UnsavedChangesBanner from "@/components/UnsavedChangesBanner";
import PublishSuccessModal from "@/components/PublishSuccessModal";
import ConfirmOnExitDialog from "@/components/ConfirmOnExitDialog";
import AppShell from "@/components/system/AppShell";
import type { SiteNavActive } from "@/components/system/SiteNav";
import { fetchProfile, getFollowListPubkeys } from "@/lib/nostr";
import { backupService } from "@/lib/backupService";
import { syncManager } from "@/lib/syncManager";

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, isConnected, disconnect, reloadMuteList } = useAuth();
  const {
    activeTab,
    setActiveTab,
    hasUnsavedChanges,
    hasCompletedOnboarding,
    setHasCompletedOnboarding,
    muteList,
    userProfile,
    setUserProfile,
    signer,
  } = useStore();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [showConfirmOnExit, setShowConfirmOnExit] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Function to change tab and update URL
  const changeTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`/dashboard?${params.toString()}`, { scroll: false });
  };

  // Sync URL with activeTab on mount and when URL changes
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    const validTabs = [
      "myList",
      "publicLists",
      "muteuals",
      "reciprocals",
      "decimator",
      "backups",
      "settings",
      "listCleaner",
      "muteOScope",
      "domainPurge",
      "purgatory",
      "noteNuke",
      "snoopable",
      "clonable",
      "muggable",
    ] as const;

    if (tabParam && validTabs.includes(tabParam as any)) {
      setActiveTab(tabParam as typeof activeTab);
    }
  }, [searchParams, setActiveTab]);

  // While React hydrates, the store reads as signed out even with a saved
  // session, so check the real state; a bounce through "/" drops ?tab= links.
  useEffect(() => {
    if (!useStore.getState().session) {
      router.push("/");
    }
  }, [session, router]);

  // Show onboarding on first visit
  useEffect(() => {
    if (isConnected && !hasCompletedOnboarding) {
      setShowOnboarding(true);
    }
  }, [isConnected, hasCompletedOnboarding]);

  // Load user profile (if not already cached)
  useEffect(() => {
    const loadUserProfile = async () => {
      if (session?.pubkey && !userProfile) {
        // Only fetch if we don't have a cached profile
        setLoadingProfile(true);
        try {
          const profile = await fetchProfile(session.pubkey, session.relays);
          if (profile) {
            setUserProfile(profile);
          }
        } catch (error) {
          console.error("Failed to load user profile:", error);
          // Don't clear cached profile on fetch error
        } finally {
          setLoadingProfile(false);
        }
      }
    };

    loadUserProfile();
  }, [session, userProfile, setUserProfile]);

  // Sync app data with relays once per tab+pubkey, after signer is ready.
  // Deferred from sign-in so the four service decrypts don't pile up as
  // simultaneous extension/bunker permission prompts during login.
  useEffect(() => {
    if (!session?.pubkey || !signer) return;
    const key = `mutable-synced-${session.pubkey}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    syncManager.syncAll(session.pubkey, session.relays).catch((error) => {
      console.error("Failed to sync app data with relays:", error);
      sessionStorage.removeItem(key);
    });
  }, [session?.pubkey, session?.relays, signer]);

  // Refresh mute list when tab becomes visible (but only if no unsaved changes)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        session &&
        !hasUnsavedChanges
      ) {
        reloadMuteList();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [session, reloadMuteList, hasUnsavedChanges]);

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        setShowConfirmOnExit(true);
        setNextUrl(window.location.pathname);
        e.returnValue =
          "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  const handleConfirmLeave = async () => {
    await handlePublishFromBanner();
    if (nextUrl) {
      router.push(nextUrl);
    }
    setShowConfirmOnExit(false);
  };

  const handleDiscardLeave = () => {
    if (nextUrl) {
      router.push(nextUrl);
    }
    setShowConfirmOnExit(false);
  };

  if (!isConnected || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
          <div className="text-lg text-gray-700 dark:text-gray-300">
            Loading...
          </div>
        </div>
      </div>
    );
  }

  const handleDisconnect = async () => {
    await disconnect();
    router.push("/");
  };

  const handleCreateBackup = async () => {
    if (!session) return;

    try {
      // Check if this is truly the first backup
      const existingMuteBackups = backupService.getBackupsByType("mute-list");
      const existingFollowBackups =
        backupService.getBackupsByType("follow-list");
      const isFirstBackup =
        existingMuteBackups.length === 0 && existingFollowBackups.length === 0;

      const backupNote = isFirstBackup
        ? "Initial backup created during onboarding"
        : "Backup created from onboarding tutorial";

      // Create mute list backup
      const muteBackup = backupService.createMuteListBackup(
        session.pubkey,
        muteList,
        backupNote,
      );
      backupService.saveBackup(muteBackup);

      // Create follow list backup with retries (3 attempts) for better reliability during onboarding
      const follows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
        3,
      );
      const followBackup = backupService.createFollowListBackup(
        session.pubkey,
        follows,
        backupNote,
      );
      backupService.saveBackup(followBackup);

      alert(
        `Backups created successfully!\n\nMute list: ${muteList.pubkeys.length + muteList.words.length + muteList.tags.length + muteList.threads.length} items\nFollow list: ${follows.length} follows`,
      );
    } catch (error) {
      console.error("Failed to create backups:", error);
      alert("Failed to create backups. Please try again.");
    }
  };

  const handleSkipOnboarding = () => {
    setHasCompletedOnboarding(true);
    setShowOnboarding(false);
  };

  const handlePublishFromBanner = async () => {
    if (!session) return;

    try {
      const { publishMuteList } = await import("@/lib/nostr");
      await publishMuteList(muteList, session.relays);
      const { setHasUnsavedChanges } = useStore.getState();
      setHasUnsavedChanges(false);
      setShowPublishSuccess(true);
    } catch (error) {
      console.error("Failed to publish:", error);
      alert(
        "Failed to publish mute list. Please try again from the My Mute List tab.",
      );
    }
  };

  const handleDiscardFromBanner = async () => {
    if (!session) return;

    if (
      confirm(
        "Are you sure you want to discard all unsaved changes? This will reload your mute list from Nostr.",
      )
    ) {
      try {
        await reloadMuteList();
      } catch (error) {
        console.error("Failed to reload mute list:", error);
        alert("Failed to reload mute list. Please try again.");
      }
    }
  };

  const handleCleanFromBanner = () => {
    changeTab("listCleaner");
  };

  return (
    <AppShell
      navActive={activeTab as SiteNavActive}
      navActiveLabel={activeTab === "settings" ? "Settings" : undefined}
      width="wide"
      mainClassName={hasUnsavedChanges ? "pb-24" : "pb-4"}
      onBrandClick={() => changeTab("myList")}
      onTabChange={(tab) => changeTab(tab as typeof activeTab)}
    >
      {activeTab === "myList" && <MyMuteList />}
      {activeTab === "publicLists" && <PublicLists />}
      {activeTab === "muteuals" && <Muteuals titleAs="h2" />}
      {activeTab === "reciprocals" && <Reciprocals titleAs="h2" />}
      {activeTab === "decimator" && <Decimator />}
      {activeTab === "noteNuke" && <NoteNuke />}
      {activeTab === "domainPurge" && <DomainPurge />}
      {activeTab === "purgatory" && <Purgatory />}
      {activeTab === "listCleaner" && <ListCleaner />}
      {activeTab === "snoopable" && <Snoopable />}
      {activeTab === "clonable" && <Clonable />}
      {activeTab === "backups" && <Backups />}
      {activeTab === "settings" && <Settings />}

      {/* Fixed Unsaved Changes Banner - always visible at bottom */}
      <UnsavedChangesBanner
        onPublish={handlePublishFromBanner}
        onDiscard={handleDiscardFromBanner}
        onClean={handleCleanFromBanner}
      />

      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal
          onClose={handleSkipOnboarding}
          onCreateBackup={handleCreateBackup}
          onSkip={handleSkipOnboarding}
        />
      )}

      {/* Publish Success Modal */}
      <PublishSuccessModal
        isOpen={showPublishSuccess}
        onClose={() => setShowPublishSuccess(false)}
        itemCount={
          muteList.pubkeys.length +
          muteList.words.length +
          muteList.tags.length +
          muteList.threads.length
        }
      />

      {/* Confirm on Exit Dialog */}
      <ConfirmOnExitDialog
        isOpen={showConfirmOnExit}
        onConfirm={handleConfirmLeave}
        onDiscard={handleDiscardLeave}
        onCancel={() => setShowConfirmOnExit(false)}
      />

    </AppShell>
  );
}

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center space-y-3">
            <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
            <div className="text-lg text-gray-700 dark:text-gray-300">
              Loading...
            </div>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
