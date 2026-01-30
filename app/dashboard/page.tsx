"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import Image from "next/image";
import Link from "next/link";
import {
  LogOut,
  User,
  Menu,
  X,
  Loader2,
  Settings as SettingsIcon,
  ChevronDown,
} from "lucide-react";

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
import GlobalUserSearch from "@/components/GlobalUserSearch";
import UserProfileModal from "@/components/UserProfileModal";
import OnboardingModal from "@/components/OnboardingModal";
import UnsavedChangesBanner from "@/components/UnsavedChangesBanner";
import PublishSuccessModal from "@/components/PublishSuccessModal";
import ConfirmOnExitDialog from "@/components/ConfirmOnExitDialog";
import Footer from "@/components/Footer";
import { Profile } from "@/types";
import { fetchProfile, getFollowListPubkeys } from "@/lib/nostr";
import { backupService } from "@/lib/backupService";

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
  } = useStore();
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [showConfirmOnExit, setShowConfirmOnExit] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Tools that go in the "Other Stuff" dropdown
  const toolTabs = [
    "noteNuke",
    "domainPurge",
    "purgatory",
    "decimator",
    "listCleaner",
    "snoopable",
  ] as const;
  const isToolTabActive = toolTabs.includes(activeTab as any);

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
    ] as const;

    if (tabParam && validTabs.includes(tabParam as any)) {
      setActiveTab(tabParam as typeof activeTab);
    }
  }, [searchParams, setActiveTab]);

  useEffect(() => {
    if (!isConnected) {
      router.push("/");
    }
  }, [isConnected, router]);

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
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

  const handleUserSelect = (profile: Profile) => {
    setSelectedProfile(profile);
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col overflow-x-hidden">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 gap-4">
            <button
              onClick={() => changeTab("myList")}
              className="flex items-center space-x-3 flex-shrink-0 hover:opacity-80 transition-opacity"
              title="Go to My Mute List"
            >
              <Image
                src="/mutable_logo.svg"
                alt="Mutable"
                width={40}
                height={40}
              />
              <Image
                src="/mutable_text.svg"
                alt="Mutable"
                width={120}
                height={24}
                className="hidden sm:block"
              />
            </button>

            {/* Global Search */}
            <GlobalUserSearch onSelectUser={handleUserSelect} />

            {/* User Menu Dropdown */}
            <div
              className="relative"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setUserMenuOpen(false);
                }
              }}
            >
              <button
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen);
                  setMobileMenuOpen(false);
                }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                {/* Avatar */}
                {loadingProfile ? (
                  <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center animate-pulse">
                    <Loader2
                      size={16}
                      className="text-gray-500 dark:text-gray-400 animate-spin"
                    />
                  </div>
                ) : userProfile?.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={userProfile.picture}
                    alt={userProfile.display_name || userProfile.name || "User"}
                    className="w-8 h-8 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';
                    }}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                    <User
                      size={16}
                      className="text-gray-600 dark:text-gray-300"
                    />
                  </div>
                )}
                {/* Name - hidden on small screens */}
                <div className="hidden md:flex flex-col text-left">
                  {loadingProfile ? (
                    <div className="space-y-1">
                      <div className="h-4 w-24 bg-gray-300 dark:bg-gray-600 rounded animate-pulse" />
                      <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </div>
                  ) : userProfile ? (
                    <>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {userProfile.display_name ||
                          userProfile.name ||
                          "Anonymous"}
                      </span>
                      {userProfile.nip05 && (
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {userProfile.nip05}
                        </span>
                      )}
                    </>
                  ) : null}
                </div>
                <ChevronDown
                  size={16}
                  className={`text-gray-500 dark:text-gray-400 transition-transform ${
                    userMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 py-1">
                  <button
                    tabIndex={0}
                    onClick={() => {
                      changeTab("settings");
                      setUserMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                      activeTab === "settings"
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    <SettingsIcon size={16} />
                    Settings
                  </button>
                  <div className="flex items-center gap-3 px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
                    <span className="w-4 text-center text-[10px]">🟢</span>
                    <span>
                      {session?.signerType === "nip46"
                        ? "NIP-46 Remote Signer"
                        : "NIP-07 Extension"}
                    </span>
                  </div>
                  <button
                    tabIndex={0}
                    onClick={() => {
                      handleDisconnect();
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <LogOut size={16} />
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Desktop Navigation */}
          <div className="hidden xl:flex justify-center space-x-6">
            <button
              onClick={() => changeTab("myList")}
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activeTab === "myList"
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              My Mutes
            </button>
            <button
              onClick={() => changeTab("publicLists")}
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activeTab === "publicLists"
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Mute Packs
            </button>
            <button
              onClick={() => changeTab("muteuals")}
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activeTab === "muteuals"
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Muteuals
            </button>
            <button
              onClick={() => changeTab("reciprocals")}
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activeTab === "reciprocals"
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Reciprocals
            </button>
            <Link
              href="/mute-o-scope"
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activeTab === "muteOScope"
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Mute-o-Scope
            </Link>
            <Link
              href="/snoopable"
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activeTab === "snoopable"
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Snoopable
            </Link>
            <button
              onClick={() => changeTab("backups")}
              className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors ${
                activeTab === "backups"
                  ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
              }`}
            >
              Backups
            </button>

            {/* Other Stuff Dropdown */}
            <div className="relative">
              <button
                onClick={() => setToolsDropdownOpen(!toolsDropdownOpen)}
                onBlur={() =>
                  setTimeout(() => setToolsDropdownOpen(false), 150)
                }
                className={`py-4 px-1 border-b-2 font-semibold text-base transition-colors flex items-center gap-1 ${
                  isToolTabActive
                    ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                Other Stuff
                <ChevronDown
                  size={16}
                  className={`transition-transform ${toolsDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {toolsDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-2 min-w-[180px] z-50">
                  <button
                    onClick={() => {
                      changeTab("noteNuke");
                      setToolsDropdownOpen(false);
                    }}
                    className={`block w-full text-left px-4 py-2.5 text-base font-semibold transition-colors ${
                      activeTab === "noteNuke"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Note Nuke
                  </button>
                  <button
                    onClick={() => {
                      changeTab("domainPurge");
                      setToolsDropdownOpen(false);
                    }}
                    className={`block w-full text-left px-4 py-2.5 text-base font-semibold transition-colors ${
                      activeTab === "domainPurge"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Domain Purge
                  </button>
                  <button
                    onClick={() => {
                      changeTab("purgatory");
                      setToolsDropdownOpen(false);
                    }}
                    className={`block w-full text-left px-4 py-2.5 text-base font-semibold transition-colors ${
                      activeTab === "purgatory"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Purgatory
                  </button>
                  <button
                    onClick={() => {
                      changeTab("decimator");
                      setToolsDropdownOpen(false);
                    }}
                    className={`block w-full text-left px-4 py-2.5 text-base font-semibold transition-colors ${
                      activeTab === "decimator"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Decimator
                  </button>
                  <button
                    onClick={() => {
                      changeTab("listCleaner");
                      setToolsDropdownOpen(false);
                    }}
                    className={`block w-full text-left px-4 py-2.5 text-base font-semibold transition-colors ${
                      activeTab === "listCleaner"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    List Cleaner
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Navigation */}
          <div className="xl:hidden">
            <button
              onClick={() => {
                setMobileMenuOpen(!mobileMenuOpen);
                setUserMenuOpen(false);
              }}
              className="flex items-center justify-between w-full py-4"
            >
              <div className="flex items-center gap-2">
                {mobileMenuOpen ? (
                  <X
                    size={22}
                    strokeWidth={2.5}
                    className="text-gray-900 dark:text-white"
                  />
                ) : (
                  <Menu
                    size={22}
                    strokeWidth={2.5}
                    className="text-gray-900 dark:text-white"
                  />
                )}
                <span className="text-base font-bold text-gray-900 dark:text-white">
                  Menu
                </span>
              </div>
              <span className="font-semibold text-base text-gray-500 dark:text-gray-400">
                {activeTab === "myList" && "My Mutes"}
                {activeTab === "publicLists" && "Mute Packs"}
                {activeTab === "muteuals" && "Muteuals"}
                {activeTab === "reciprocals" && "Reciprocals"}
                {activeTab === "decimator" && "Decimator"}
                {activeTab === "domainPurge" && "Domain Purge"}
                {activeTab === "purgatory" && "Purgatory"}
                {activeTab === "muteOScope" && "Mute-o-Scope"}
                {activeTab === "noteNuke" && "Note Nuke"}
                {activeTab === "listCleaner" && "List Cleaner"}
                {activeTab === "snoopable" && "Snoopable"}
                {activeTab === "backups" && "Backups"}
                {activeTab === "settings" && "Settings"}
              </span>
            </button>

            {/* Mobile Dropdown Menu */}
            {mobileMenuOpen && (
              <div className="absolute left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
                  {/* Primary pages */}
                  <button
                    onClick={() => {
                      changeTab("myList");
                      setMobileMenuOpen(false);
                    }}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "myList"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    My Mutes
                  </button>
                  <button
                    onClick={() => {
                      changeTab("publicLists");
                      setMobileMenuOpen(false);
                    }}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "publicLists"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Mute Packs
                  </button>
                  <button
                    onClick={() => {
                      changeTab("muteuals");
                      setMobileMenuOpen(false);
                    }}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "muteuals"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Muteuals
                  </button>
                  <button
                    onClick={() => {
                      changeTab("reciprocals");
                      setMobileMenuOpen(false);
                    }}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "reciprocals"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Reciprocals
                  </button>
                  <Link
                    href="/mute-o-scope"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "muteOScope"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Mute-o-Scope
                  </Link>
                  <Link
                    href="/snoopable"
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "snoopable"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Snoopable
                  </Link>
                  <button
                    onClick={() => {
                      changeTab("backups");
                      setMobileMenuOpen(false);
                    }}
                    className={`block w-full text-left py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "backups"
                        ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                        : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}
                  >
                    Backups
                  </button>

                  {/* Other Stuff Accordion */}
                  <div className="mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
                    <button
                      onClick={() => setMobileToolsOpen(!mobileToolsOpen)}
                      className={`flex items-center justify-between w-full py-3 px-4 rounded-lg font-semibold text-sm transition-colors ${
                        isToolTabActive
                          ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                          : "text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700"
                      }`}
                    >
                      <span>Other Stuff</span>
                      <ChevronDown
                        size={16}
                        className={`transition-transform ${mobileToolsOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {/* Tool pages nested under accordion */}
                    {mobileToolsOpen && (
                      <div className="ml-4 mt-1 space-y-1">
                        <button
                          onClick={() => {
                            changeTab("noteNuke");
                            setMobileMenuOpen(false);
                          }}
                          className={`block w-full text-left py-2.5 px-4 rounded-lg font-medium text-sm transition-colors ${
                            activeTab === "noteNuke"
                              ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          Note Nuke
                        </button>
                        <button
                          onClick={() => {
                            changeTab("domainPurge");
                            setMobileMenuOpen(false);
                          }}
                          className={`block w-full text-left py-2.5 px-4 rounded-lg font-medium text-sm transition-colors ${
                            activeTab === "domainPurge"
                              ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          Domain Purge
                        </button>
                        <button
                          onClick={() => {
                            changeTab("purgatory");
                            setMobileMenuOpen(false);
                          }}
                          className={`block w-full text-left py-2.5 px-4 rounded-lg font-medium text-sm transition-colors ${
                            activeTab === "purgatory"
                              ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          Purgatory
                        </button>
                        <button
                          onClick={() => {
                            changeTab("decimator");
                            setMobileMenuOpen(false);
                          }}
                          className={`block w-full text-left py-2.5 px-4 rounded-lg font-medium text-sm transition-colors ${
                            activeTab === "decimator"
                              ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          Decimator
                        </button>
                        <button
                          onClick={() => {
                            changeTab("listCleaner");
                            setMobileMenuOpen(false);
                          }}
                          className={`block w-full text-left py-2.5 px-4 rounded-lg font-medium text-sm transition-colors ${
                            activeTab === "listCleaner"
                              ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          List Cleaner
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content - add bottom padding when banner is visible */}
      <main
        className={`w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 flex-grow ${hasUnsavedChanges ? "pb-24" : "pb-4"}`}
      >
        {activeTab === "myList" && <MyMuteList />}
        {activeTab === "publicLists" && <PublicLists />}
        {activeTab === "muteuals" && <Muteuals />}
        {activeTab === "reciprocals" && <Reciprocals />}
        {activeTab === "decimator" && <Decimator />}
        {activeTab === "noteNuke" && <NoteNuke />}
        {activeTab === "domainPurge" && <DomainPurge />}
        {activeTab === "purgatory" && <Purgatory />}
        {activeTab === "listCleaner" && <ListCleaner />}
        {activeTab === "snoopable" && <Snoopable />}
        {activeTab === "backups" && <Backups />}
        {activeTab === "settings" && <Settings />}
      </main>

      <Footer />

      {/* Fixed Unsaved Changes Banner - always visible at bottom */}
      <UnsavedChangesBanner
        onPublish={handlePublishFromBanner}
        onDiscard={handleDiscardFromBanner}
        onClean={handleCleanFromBanner}
      />

      {/* User Profile Modal */}
      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}

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
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
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
