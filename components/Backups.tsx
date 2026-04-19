"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { useRelaySync } from "@/hooks/useRelaySync";
import {
  backupService,
  Backup,
  BackupType,
  RawListBackupPayload,
  LIST_KIND_TO_TYPE,
} from "@/lib/backupService";
import {
  MuteBackupData,
  ProfileBackupData,
  ListBackupResult,
} from "@/lib/relayStorage";
import { profileBackupService } from "@/lib/profileBackupService";
import {
  getFollowListPubkeys,
  publishMuteList,
  publishFollowList,
  publishProfile,
  fetchRawProfileContent,
} from "@/lib/nostr";
import {
  fetchRawListEvent,
  publishClonedRawListEvent,
} from "@/lib/clonableService";
import {
  Archive,
  Download,
  Upload,
  Trash2,
  Calendar,
  FileText,
  Shield,
  Users,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
  Cloud,
  CloudOff,
  Lock,
  ChevronDown,
  ChevronUp,
  User,
  RotateCcw,
  Bookmark,
  Pin,
  Hash,
} from "lucide-react";

type ListKind = 10001 | 10003 | 10015;
const LIST_KINDS: ReadonlyArray<ListKind> = [10003, 10015, 10001];

type RelayListBackup = NonNullable<ListBackupResult["backup"]>;

interface BackupTypeMeta {
  label: string;
  badgeBg: string;
  iconColor: string;
  icon: typeof Archive;
  tabActiveClass: string;
  statCardIconBg: string;
}

const BACKUP_TYPE_META: Record<BackupType, BackupTypeMeta> = {
  "mute-list": {
    label: "Mute List Backup",
    badgeBg: "bg-red-100 dark:bg-red-900/30",
    iconColor: "text-red-600 dark:text-red-400",
    icon: Shield,
    tabActiveClass: "bg-red-600 text-white",
    statCardIconBg: "bg-red-100 dark:bg-red-900/30",
  },
  "follow-list": {
    label: "Follow List Backup",
    badgeBg: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
    icon: Users,
    tabActiveClass: "bg-blue-600 text-white",
    statCardIconBg: "bg-blue-100 dark:bg-blue-900/30",
  },
  bookmarks: {
    label: "Bookmarks Backup",
    badgeBg: "bg-yellow-100 dark:bg-yellow-900/30",
    iconColor: "text-yellow-600 dark:text-yellow-400",
    icon: Bookmark,
    tabActiveClass: "bg-yellow-600 text-white",
    statCardIconBg: "bg-yellow-100 dark:bg-yellow-900/30",
  },
  "pinned-notes": {
    label: "Pinned Notes Backup",
    badgeBg: "bg-indigo-100 dark:bg-indigo-900/30",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    icon: Pin,
    tabActiveClass: "bg-indigo-600 text-white",
    statCardIconBg: "bg-indigo-100 dark:bg-indigo-900/30",
  },
  interests: {
    label: "Interests Backup",
    badgeBg: "bg-teal-100 dark:bg-teal-900/30",
    iconColor: "text-teal-600 dark:text-teal-400",
    icon: Hash,
    tabActiveClass: "bg-teal-600 text-white",
    statCardIconBg: "bg-teal-100 dark:bg-teal-900/30",
  },
};

export default function Backups() {
  const { session } = useAuth();
  const { muteList, setMuteList, signer } = useStore();
  const {
    saveBackupToRelay,
    fetchBackupFromRelay,
    saveListBackupToRelay,
    fetchListBackupFromRelay,
  } = useRelaySync();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selectedType, setSelectedType] = useState<"all" | BackupType>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Relay backup state
  const [relayBackup, setRelayBackup] = useState<MuteBackupData | null>(null);
  const [relayBackupLoading, setRelayBackupLoading] = useState(false);
  const [relayBackupSaving, setRelayBackupSaving] = useState(false);
  const [relayBackupRestoring, setRelayBackupRestoring] = useState(false);
  const [showRelayList, setShowRelayList] = useState(false);
  const [includeFollowList, setIncludeFollowList] = useState(true);
  const [foundOnRelays, setFoundOnRelays] = useState<string[]>([]);
  const [queriedRelays, setQueriedRelays] = useState<string[]>([]);
  const [relayBackupError, setRelayBackupError] = useState<string | null>(null);

  // List (NIP-51) relay backup state — keyed by kind (10001 / 10003 / 10015)
  const [listRelayBackups, setListRelayBackups] = useState<
    Record<number, RelayListBackup | null>
  >({});
  const [listFoundOnRelays, setListFoundOnRelays] = useState<
    Record<number, string[]>
  >({});
  const [listQueriedRelays, setListQueriedRelays] = useState<
    Record<number, string[]>
  >({});
  const [listRelayErrors, setListRelayErrors] = useState<
    Record<number, string | undefined>
  >({});
  const [listBackupLoading, setListBackupLoading] = useState<
    Record<number, boolean>
  >({});
  const [listBackupSaving, setListBackupSaving] = useState<number | null>(null);
  const [listBackupRestoring, setListBackupRestoring] = useState<
    number | null
  >(null);
  const [showListRelayDetails, setShowListRelayDetails] = useState<
    Record<number, boolean>
  >({});

  // Profile backup state
  const [profileBackups, setProfileBackups] = useState<
    Array<{ slot: number; data: ProfileBackupData }>
  >([]);
  const [profileBackupsLoading, setProfileBackupsLoading] = useState(false);
  const [showProfileBackups, setShowProfileBackups] = useState(false);
  const [profileRestoring, setProfileRestoring] = useState<number | null>(null);

  // Load backups
  useEffect(() => {
    loadBackups();
  }, []);

  // Fetch relay backup once signer is available (not just session)
  // NIP-46 signers restore asynchronously, so session exists before signer is ready
  useEffect(() => {
    if (session && signer) {
      loadRelayBackup(signer);
      // Fetch list backups in parallel
      for (const kind of LIST_KINDS) {
        loadListRelayBackup(kind, signer);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, signer]);

  const loadBackups = () => {
    const allBackups = backupService.getAllBackups();
    setBackups(allBackups);
  };

  const loadRelayBackup = async (signerOverride?: import("@/lib/signers").Signer) => {
    // Use the passed signer (from useEffect where React state is reliable),
    // or fall back to store for manual calls (refresh button, post-save)
    const activeSigner = signerOverride || useStore.getState().signer;
    if (!activeSigner) {
      console.warn("[Backups] No signer available for relay backup fetch");
      return;
    }

    setRelayBackupLoading(true);
    setRelayBackupError(null);
    try {
      const result = await fetchBackupFromRelay(activeSigner);
      setRelayBackup(result.backup || null);
      setFoundOnRelays(result.foundOnRelays || []);
      setQueriedRelays(result.queriedRelays || []);
      if (result.error) {
        setRelayBackupError(result.error);
      }
    } catch (error) {
      console.error("Failed to fetch relay backup:", error);
    } finally {
      setRelayBackupLoading(false);
    }
  };

  const loadListRelayBackup = useCallback(
    async (
      kind: number,
      signerOverride?: import("@/lib/signers").Signer,
    ) => {
      const activeSigner = signerOverride || useStore.getState().signer;
      if (!activeSigner) {
        console.warn(
          `[Backups] No signer available for list relay backup fetch (kind ${kind})`,
        );
        return;
      }

      setListBackupLoading((prev) => ({ ...prev, [kind]: true }));
      setListRelayErrors((prev) => ({ ...prev, [kind]: undefined }));
      try {
        const result = await fetchListBackupFromRelay(kind, activeSigner);
        setListRelayBackups((prev) => ({
          ...prev,
          [kind]: result.backup || null,
        }));
        setListFoundOnRelays((prev) => ({
          ...prev,
          [kind]: result.foundOnRelays || [],
        }));
        setListQueriedRelays((prev) => ({
          ...prev,
          [kind]: result.queriedRelays || [],
        }));
        if (result.error) {
          setListRelayErrors((prev) => ({ ...prev, [kind]: result.error }));
        }
      } catch (error) {
        console.error(
          `Failed to fetch list relay backup (kind ${kind}):`,
          error,
        );
      } finally {
        setListBackupLoading((prev) => ({ ...prev, [kind]: false }));
      }
    },
    [fetchListBackupFromRelay],
  );

  const loadProfileBackups = async () => {
    if (!session) return;
    setProfileBackupsLoading(true);
    try {
      const all = await profileBackupService.fetchAllBackups(
        session.pubkey,
        session.relays,
      );
      const valid = all.filter(
        (r): r is { slot: number; data: ProfileBackupData } =>
          r.data !== null && typeof r.data.timestamp === "number",
      );
      valid.sort((a, b) => b.data.timestamp - a.data.timestamp);
      setProfileBackups(valid);
    } catch (error) {
      console.error("Failed to load profile backups:", error);
    } finally {
      setProfileBackupsLoading(false);
    }
  };

  const handleToggleProfileBackups = () => {
    if (!showProfileBackups) {
      setShowProfileBackups(true);
      loadProfileBackups();
    } else {
      setShowProfileBackups(false);
    }
  };

  const handleRestoreProfileBackup = async (
    backup: ProfileBackupData,
    slot: number,
  ) => {
    if (!session) return;

    const profileName =
      (backup.profile.display_name as string) ||
      (backup.profile.name as string) ||
      "unnamed profile";

    if (
      !confirm(
        `Restore profile "${profileName}" from ${new Date(backup.timestamp).toLocaleString()}? This will publish it as your current profile.`,
      )
    ) {
      return;
    }

    setProfileRestoring(slot);
    try {
      // Fetch current raw content to preserve unknown fields
      const existingContent = await fetchRawProfileContent(
        session.pubkey,
        session.relays,
      );

      const profileData = {
        name: (backup.profile.name as string) || "",
        display_name: (backup.profile.display_name as string) || "",
        about: (backup.profile.about as string) || "",
        picture: (backup.profile.picture as string) || "",
        banner: (backup.profile.banner as string) || "",
        nip05: (backup.profile.nip05 as string) || "",
        website: (backup.profile.website as string) || "",
        lud16: (backup.profile.lud16 as string) || "",
      };

      await publishProfile(
        profileData,
        existingContent || undefined,
        session.relays,
      );

      // Update store
      const { setUserProfile } = useStore.getState();
      setUserProfile({
        pubkey: session.pubkey,
        ...profileData,
      });

      setSuccessMessage("Profile restored and published successfully!");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to restore profile backup",
      );
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setProfileRestoring(null);
    }
  };

  const handleSaveToRelay = async () => {
    if (!session) return;

    setRelayBackupSaving(true);
    setErrorMessage(null);

    try {
      // Optionally fetch follow list to include in backup
      let followList: string[] | undefined;
      if (includeFollowList) {
        try {
          followList = await getFollowListPubkeys(
            session.pubkey,
            session.relays,
            3,
          );
        } catch (error) {
          console.warn("Failed to fetch follow list for backup:", error);
        }
      }

      const result = await saveBackupToRelay(muteList, undefined, followList);
      if (result.success) {
        const message = followList
          ? `Backup saved to relays (${muteList.pubkeys.length} muted, ${followList.length} follows)`
          : "Mute list backup saved to relays";
        setSuccessMessage(message);
        setTimeout(() => setSuccessMessage(null), 5000);

        // Mirror the list-backup pattern: write local-history entries so the
        // Backups tab timeline stays consistent across all types.
        const muteLocal = backupService.createMuteListBackup(
          session.pubkey,
          muteList,
          "Saved from Backups tab (relay)",
        );
        backupService.saveBackup(muteLocal);
        if (followList) {
          const followLocal = backupService.createFollowListBackup(
            session.pubkey,
            followList,
            "Saved from Backups tab (relay)",
          );
          backupService.saveBackup(followLocal);
        }
        loadBackups();

        // Refresh relay backup status
        await loadRelayBackup();
      } else {
        setErrorMessage(result.error || "Failed to save backup to relays");
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to save backup to relays",
      );
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setRelayBackupSaving(false);
    }
  };

  const handleRestoreFromRelay = async () => {
    if (!session || !relayBackup) return;

    const hasFollowList =
      relayBackup.followList && relayBackup.followList.length > 0;
    const confirmMessage = hasFollowList
      ? "Are you sure you want to restore from relay backup? This will replace your current mute list and follow list, and publish them immediately."
      : "Are you sure you want to restore from relay backup? This will replace your current mute list and publish it immediately.";

    if (!confirm(confirmMessage)) {
      return;
    }

    setRelayBackupRestoring(true);
    setErrorMessage(null);

    try {
      // Update the mute list in the store
      setMuteList(relayBackup.muteList);

      // Publish mute list
      await publishMuteList(relayBackup.muteList, session.relays);

      // Publish follow list if present
      if (hasFollowList) {
        await publishFollowList(relayBackup.followList!, session.relays);
      }

      const message = hasFollowList
        ? "Mute list and follow list restored and published!"
        : "Mute list restored and published!";
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to restore backup from relays",
      );
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setRelayBackupRestoring(false);
    }
  };

  const filteredBackups =
    selectedType === "all"
      ? backups
      : backups.filter((b) => b.type === selectedType);

  const handleCreateMuteListBackup = async () => {
    if (!session) return;

    try {
      setIsCreating(true);
      setErrorMessage(null);

      const backup = backupService.createMuteListBackup(
        session.pubkey,
        muteList,
        "Manual backup created from Backups tab",
      );

      const saved = backupService.saveBackup(backup);

      if (saved) {
        loadBackups();
        setSuccessMessage(
          `Mute list backup created with ${muteList.pubkeys.length + muteList.words.length + muteList.tags.length + muteList.threads.length} items`,
        );
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setErrorMessage("Failed to save backup to storage");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create backup",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateFollowListBackup = async () => {
    if (!session) return;

    try {
      setIsCreating(true);
      setErrorMessage(null);

      // Use retries for better reliability
      const follows = await getFollowListPubkeys(
        session.pubkey,
        session.relays,
        3,
      );
      const backup = backupService.createFollowListBackup(
        session.pubkey,
        follows,
        "Manual backup created from Backups tab",
      );

      const saved = backupService.saveBackup(backup);

      if (saved) {
        loadBackups();
        setSuccessMessage(
          `Follow list backup created with ${follows.length} follows`,
        );
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setErrorMessage("Failed to save backup to storage");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create backup",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveListToRelay = async (kind: ListKind) => {
    if (!session) return;
    const type = LIST_KIND_TO_TYPE[kind];
    if (!type) return;

    setListBackupSaving(kind);
    setErrorMessage(null);
    try {
      const raw = await fetchRawListEvent(
        session.pubkey,
        kind,
        session.relays,
      );
      if (!raw) {
        setErrorMessage(
          `Nothing to back up - no ${BACKUP_TYPE_META[type].label.replace(" Backup", "").toLowerCase()} event found on your relays`,
        );
        setTimeout(() => setErrorMessage(null), 5000);
        return;
      }

      const payload: RawListBackupPayload = {
        kind: raw.kind,
        tags: raw.tags,
        content: raw.content || "",
      };

      const result = await saveListBackupToRelay(
        kind,
        payload,
        "Saved from Backups tab",
      );
      if (result.success) {
        setSuccessMessage(
          `${BACKUP_TYPE_META[type].label} saved to relays (${payload.tags.length} items${result.result ? `, ${result.result.savedChunks}/${result.result.totalChunks} chunks` : ""})`,
        );
        setTimeout(() => setSuccessMessage(null), 5000);

        // Also create a local history entry so export is possible.
        const localBackup = backupService.createListBackup(
          session.pubkey,
          type as "bookmarks" | "pinned-notes" | "interests",
          payload,
          "Saved from Backups tab (relay)",
        );
        if (backupService.saveBackup(localBackup)) {
          loadBackups();
        }

        await loadListRelayBackup(kind);
      } else {
        setErrorMessage(result.error || "Failed to save list backup to relays");
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save list backup",
      );
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setListBackupSaving(null);
    }
  };

  const handleRestoreListFromRelay = async (kind: ListKind) => {
    if (!session) return;
    const type = LIST_KIND_TO_TYPE[kind];
    if (!type) return;
    const backup = listRelayBackups[kind];
    if (!backup) return;

    const typeLabel = BACKUP_TYPE_META[type].label.replace(" Backup", "");
    if (
      !confirm(
        `Restore your ${typeLabel.toLowerCase()} from relay backup? This will replace your current ${typeLabel.toLowerCase()} list on relays and publish it immediately.`,
      )
    ) {
      return;
    }

    setListBackupRestoring(kind);
    setErrorMessage(null);
    try {
      await publishClonedRawListEvent(
        { kind: backup.kind, tags: backup.tags, content: backup.content },
        session.relays,
      );
      setSuccessMessage(
        `${typeLabel} restored and published (${backup.tags.length} items)`,
      );
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to restore list backup from relays",
      );
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setListBackupRestoring(null);
    }
  };

  const handleExportBackup = (backup: Backup) => {
    try {
      backupService.exportBackupToFile(backup);
      setSuccessMessage("Backup downloaded successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setErrorMessage("Failed to export backup");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  const handleImportBackup = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const result = await backupService.importBackupFromFile(content);

      if (result.success) {
        loadBackups();
        setSuccessMessage("Backup imported successfully");
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setErrorMessage(result.error || "Failed to import backup");
        setTimeout(() => setErrorMessage(null), 5000);
      }
    } catch (error) {
      setErrorMessage("Failed to read backup file");
      setTimeout(() => setErrorMessage(null), 5000);
    }

    // Reset file input
    event.target.value = "";
  };

  const handleDeleteBackup = (backupId: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this backup? This action cannot be undone.",
      )
    ) {
      return;
    }

    const success = backupService.deleteBackup(backupId);
    if (success) {
      loadBackups();
      setSuccessMessage("Backup deleted successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      setErrorMessage("Failed to delete backup");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  const handleDeleteAllBackups = () => {
    if (
      !confirm(
        "Are you sure you want to delete ALL backups? This action cannot be undone and you will lose all backup history.",
      )
    ) {
      return;
    }

    const success = backupService.deleteAllBackups();
    if (success) {
      loadBackups();
      setSuccessMessage("All backups deleted successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      setErrorMessage("Failed to delete all backups");
      setTimeout(() => setErrorMessage(null), 3000);
    }
  };

  const handleRestoreBackup = async (backup: Backup) => {
    if (!session) {
      setErrorMessage("Please sign in to restore backups");
      setTimeout(() => setErrorMessage(null), 3000);
      return;
    }

    if (backup.type === "mute-list") {
      if (
        !confirm(
          "Are you sure you want to restore this mute list backup? This will replace your current mute list and publish it immediately.",
        )
      ) {
        return;
      }

      try {
        const restoredMuteList = backupService.restoreMuteListBackup(backup.id);
        if (!restoredMuteList) {
          setErrorMessage("Failed to restore backup");
          setTimeout(() => setErrorMessage(null), 3000);
          return;
        }

        // Update the mute list in the store
        setMuteList(restoredMuteList);

        // Publish immediately
        try {
          await publishMuteList(restoredMuteList, session.relays);
          setSuccessMessage("Backup restored and published successfully!");
          setTimeout(() => setSuccessMessage(null), 5000);
        } catch (publishError) {
          setErrorMessage(
            "Backup restored but failed to publish. Please try publishing manually.",
          );
          setTimeout(() => setErrorMessage(null), 5000);
        }
      } catch (error) {
        setErrorMessage("Failed to restore and publish backup");
        setTimeout(() => setErrorMessage(null), 3000);
      }
    } else if (backup.type === "follow-list") {
      if (
        !confirm(
          "Are you sure you want to restore this follow list backup? This will replace your current follow list and publish it immediately.",
        )
      ) {
        return;
      }

      try {
        const restoredFollowList = backupService.restoreFollowListBackup(
          backup.id,
        );
        if (!restoredFollowList) {
          setErrorMessage("Failed to restore backup");
          setTimeout(() => setErrorMessage(null), 3000);
          return;
        }

        // Publish follow list immediately
        try {
          await publishFollowList(restoredFollowList, session.relays);
          setSuccessMessage(
            `Follow list restored and published successfully! (${restoredFollowList.length} follows)`,
          );
          setTimeout(() => setSuccessMessage(null), 5000);
        } catch (publishError) {
          setErrorMessage(
            "Backup restored but failed to publish. Please try publishing manually.",
          );
          setTimeout(() => setErrorMessage(null), 5000);
        }
      } catch (error) {
        setErrorMessage("Failed to restore and publish backup");
        setTimeout(() => setErrorMessage(null), 3000);
      }
    } else if (
      backup.type === "bookmarks" ||
      backup.type === "pinned-notes" ||
      backup.type === "interests"
    ) {
      const typeLabel = BACKUP_TYPE_META[backup.type].label.replace(
        " Backup",
        "",
      );
      if (
        !confirm(
          `Restore this ${typeLabel.toLowerCase()} backup? This will replace your current ${typeLabel.toLowerCase()} list and publish it immediately.`,
        )
      ) {
        return;
      }

      try {
        const payload = backupService.restoreListBackup(backup.id);
        if (!payload) {
          setErrorMessage("Failed to restore backup");
          setTimeout(() => setErrorMessage(null), 3000);
          return;
        }
        try {
          await publishClonedRawListEvent(
            {
              kind: payload.kind,
              tags: payload.tags,
              content: payload.content,
            },
            session.relays,
          );
          setSuccessMessage(
            `${typeLabel} restored and published (${payload.tags.length} items)`,
          );
          setTimeout(() => setSuccessMessage(null), 5000);
        } catch (publishError) {
          setErrorMessage(
            "Backup restored but failed to publish. Please try publishing manually.",
          );
          setTimeout(() => setErrorMessage(null), 5000);
        }
      } catch (error) {
        setErrorMessage("Failed to restore and publish backup");
        setTimeout(() => setErrorMessage(null), 3000);
      }
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getBackupItemCount = (backup: Backup): number => {
    if (backup.type === "mute-list") {
      const data = backup.data as any;
      return (
        data.pubkeys.length +
        data.words.length +
        data.tags.length +
        data.threads.length
      );
    }
    if (backup.type === "follow-list") {
      return (backup.data as string[]).length;
    }
    // bookmarks / pinned-notes / interests — RawListBackupPayload
    const data = backup.data as RawListBackupPayload;
    return Array.isArray(data?.tags) ? data.tags.length : 0;
  };

  const muteListBackups = backups.filter((b) => b.type === "mute-list");
  const followListBackups = backups.filter((b) => b.type === "follow-list");
  const bookmarksBackups = backups.filter((b) => b.type === "bookmarks");
  const pinnedNotesBackups = backups.filter((b) => b.type === "pinned-notes");
  const interestsBackups = backups.filter((b) => b.type === "interests");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Backups
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage backups of your mute list, follows, and bookmarks
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleCreateMuteListBackup}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Archive size={18} />
            <span className="hidden sm:inline">Backup Mute List</span>
          </button>
          <button
            onClick={handleCreateFollowListBackup}
            disabled={isCreating}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Users size={18} />
            <span className="hidden sm:inline">Backup Follows</span>
          </button>
          <a
            href="#list-relay-backup"
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("list-relay-backup")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            <Bookmark size={18} />
            <span className="hidden sm:inline">More Backups</span>
          </a>
        </div>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="p-4 bg-green-100 dark:bg-green-900/30 border border-green-400 dark:border-green-700 rounded-lg flex items-center gap-2">
          <CheckCircle
            size={20}
            className="text-green-600 dark:text-green-400"
          />
          <span className="text-green-800 dark:text-green-200">
            {successMessage}
          </span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg flex items-center gap-2">
          <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">{errorMessage}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-lg">
              <Shield className="text-red-600 dark:text-red-400" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Mute List Backups
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {muteListBackups.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <Users className="text-blue-600 dark:text-blue-400" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Follow List Backups
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {followListBackups.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
              <Bookmark
                className="text-yellow-600 dark:text-yellow-400"
                size={24}
              />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Bookmarks Backups
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {bookmarksBackups.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <Archive className="text-gray-600 dark:text-gray-400" size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Total Backups
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {backups.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedType("all")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedType === "all"
                  ? "bg-red-600 text-white"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              All ({backups.length})
            </button>
            {(
              [
                ["mute-list", "Mute Lists", muteListBackups.length],
                ["follow-list", "Follow Lists", followListBackups.length],
                ["bookmarks", "Bookmarks", bookmarksBackups.length],
                ["interests", "Interests", interestsBackups.length],
                ["pinned-notes", "Pinned Notes", pinnedNotesBackups.length],
              ] as Array<[BackupType, string, number]>
            ).map(([type, label, count]) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  selectedType === type
                    ? BACKUP_TYPE_META[type].tabActiveClass
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                }`}
              >
                {label} ({count})
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <label className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer">
              <Upload size={18} />
              <span>Import</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>
            {backups.length > 0 && (
              <button
                onClick={handleDeleteAllBackups}
                className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                <Trash2 size={18} />
                <span className="hidden sm:inline">Delete All</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle
            className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
            size={20}
          />
          <div className="text-sm text-blue-900 dark:text-blue-200">
            <p className="font-semibold mb-1">About Backups</p>
            <ul className="space-y-1 ml-4 list-disc">
              <li>Backups are stored in your browser&apos;s local storage</li>
              <li>Up to 50 backups per type are kept automatically</li>
              <li>Export backups to your computer for safekeeping</li>
              <li>Import previously exported backups from JSON files</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Relay Backup Storage */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
            <Lock className="text-purple-600 dark:text-purple-400" size={24} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Relay Backup Storage
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Store your mute list and follow list on Nostr relays for
              cross-device access. Encrypted with your keys.
            </p>

            {/* Status */}
            <div className="mb-4">
              {relayBackupLoading ? (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Checking relay backup...</span>
                </div>
              ) : relayBackup ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <Cloud size={16} />
                  <span>
                    Backup saved ({formatDate(relayBackup.timestamp)})
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                  <CloudOff size={16} />
                  <span>No relay backup found</span>
                </div>
              )}

              {relayBackupError && (
                <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      size={16}
                      className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
                    />
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {relayBackupError.includes("too large for remote signer") ||
                        relayBackupError.includes("plaintext size")
                        ? "Backup too large to decrypt with a remote signer (NIP-46). Log in with a browser extension (NIP-07) and click \"Save to Relays\" to re-save in the new split format."
                        : relayBackupError}
                    </p>
                  </div>
                </div>
              )}

              {relayBackup && (
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-6">
                  <p>
                    Mutes: {relayBackup.muteList.pubkeys.length} profiles,{" "}
                    {relayBackup.muteList.words.length} words,{" "}
                    {relayBackup.muteList.tags.length} hashtags,{" "}
                    {relayBackup.muteList.threads.length} threads
                  </p>
                  {relayBackup.followList &&
                    relayBackup.followList.length > 0 && (
                      <p>Follows: {relayBackup.followList.length} profiles</p>
                    )}
                </div>
              )}
            </div>

            {/* Include follow list checkbox */}
            <div className="mb-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFollowList}
                  onChange={(e) => setIncludeFollowList(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
                />
                <span>Include follow list in backup</span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={handleSaveToRelay}
                disabled={relayBackupSaving || !session}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {relayBackupSaving ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Cloud size={16} />
                )}
                <span>Save to Relays</span>
              </button>

              <button
                onClick={handleRestoreFromRelay}
                disabled={relayBackupRestoring || !relayBackup || !session}
                className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {relayBackupRestoring ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                <span>Restore from Relays</span>
              </button>

              <button
                onClick={() => loadRelayBackup()}
                disabled={relayBackupLoading}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
                title="Refresh relay backup status"
              >
                <RefreshCw
                  size={16}
                  className={relayBackupLoading ? "animate-spin" : ""}
                />
              </button>
            </div>

            {/* Relay list toggle */}
            {queriedRelays.length > 0 && (
              <div>
                <button
                  onClick={() => setShowRelayList(!showRelayList)}
                  className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {showRelayList ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  <span>
                    {showRelayList ? "Hide" : "Show"} relays (
                    {foundOnRelays.length}/{queriedRelays.length} have backup)
                  </span>
                </button>
                {showRelayList && (
                  <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <ul className="text-xs space-y-1">
                      {queriedRelays.map((relay) => {
                        const hasBackup = foundOnRelays.includes(relay);
                        return (
                          <li
                            key={relay}
                            className={`truncate flex items-center gap-2 ${
                              hasBackup
                                ? "text-green-600 dark:text-green-400"
                                : "text-gray-400 dark:text-gray-500"
                            }`}
                          >
                            {hasBackup ? (
                              <CheckCircle
                                size={12}
                                className="flex-shrink-0"
                              />
                            ) : (
                              <CloudOff size={12} className="flex-shrink-0" />
                            )}
                            {relay}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Profile Backups subsection */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                  <User
                    className="text-orange-600 dark:text-orange-400"
                    size={18}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Profile Backups
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Encrypted snapshots of your profile, created automatically
                    when you edit your profile. Up to 3 rotating backups.
                  </p>
                </div>
              </div>

              <button
                onClick={handleToggleProfileBackups}
                className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {showProfileBackups ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                <span>
                  {showProfileBackups ? "Hide" : "Show"} profile backups
                </span>
              </button>

              {showProfileBackups && (
                <div className="mt-3 space-y-2">
                  {profileBackupsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Loading profile backups...</span>
                    </div>
                  ) : profileBackups.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No profile backups found. Backups are created
                      automatically when you save changes in the profile editor.
                    </p>
                  ) : (
                    profileBackups.map((backup) => (
                      <div
                        key={backup.slot}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {typeof backup.data.profile.picture === "string" &&
                              backup.data.profile.picture && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={backup.data.profile.picture}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                  onError={(e) => {
                                    (
                                      e.target as HTMLImageElement
                                    ).style.display = "none";
                                  }}
                                />
                              )}
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {(backup.data.profile.display_name as string) ||
                                  (backup.data.profile.name as string) ||
                                  "Unnamed"}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {formatDate(backup.data.timestamp)} &middot;
                                Slot {backup.slot}
                              </p>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRestoreProfileBackup(backup.data, backup.slot)
                          }
                          disabled={profileRestoring !== null}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors disabled:opacity-50 flex-shrink-0 ml-3"
                        >
                          {profileRestoring === backup.slot ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                          Restore
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bookmarks & Lists Relay Backup */}
      <div
        id="list-relay-backup"
        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 scroll-mt-4"
      >
        <div className="flex items-start gap-4">
          <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
            <Bookmark
              className="text-yellow-600 dark:text-yellow-400"
              size={24}
            />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Bookmarks & Lists Relay Backup
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Encrypted cross-device backups of your bookmarks, pinned notes,
              and interests. Restore republishes the list verbatim — private
              (encrypted) items survive without ever being decrypted here.
            </p>

            <div className="space-y-4">
              {LIST_KINDS.map((kind) => {
                const type = LIST_KIND_TO_TYPE[kind];
                if (!type) return null;
                const meta = BACKUP_TYPE_META[type];
                const Icon = meta.icon;
                const loading = !!listBackupLoading[kind];
                const saving = listBackupSaving === kind;
                const restoring = listBackupRestoring === kind;
                const backup = listRelayBackups[kind] || null;
                const err = listRelayErrors[kind];
                const found = listFoundOnRelays[kind] || [];
                const queried = listQueriedRelays[kind] || [];
                const showDetails = !!showListRelayDetails[kind];

                return (
                  <div
                    key={kind}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${meta.badgeBg}`}>
                        <Icon className={meta.iconColor} size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                            {meta.label.replace(" Backup", "")}
                          </h3>
                          {loading ? (
                            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <RefreshCw size={12} className="animate-spin" />
                              Checking…
                            </span>
                          ) : backup ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                              <Cloud size={12} />
                              Backed up {formatDate(backup.timestamp)}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <CloudOff size={12} />
                              No relay backup
                            </span>
                          )}
                        </div>

                        {backup && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {backup.tags.length} items
                            {backup.content ? " • includes private items" : ""}
                            {backup.fetchedChunks < backup.totalChunks
                              ? ` • ${backup.fetchedChunks}/${backup.totalChunks} chunks reassembled`
                              : ""}
                          </p>
                        )}

                        {err && (
                          <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded">
                            <div className="flex items-start gap-2">
                              <AlertTriangle
                                size={14}
                                className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
                              />
                              <p className="text-xs text-amber-700 dark:text-amber-300">
                                {err.includes("too large for remote signer") ||
                                err.includes("plaintext size")
                                  ? "Backup too large to decrypt with a remote signer (NIP-46). Log in with a browser extension (NIP-07) to decrypt."
                                  : err}
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => handleSaveListToRelay(kind)}
                            disabled={saving || !session}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {saving ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <Cloud size={14} />
                            )}
                            Save to Relays
                          </button>
                          <button
                            onClick={() => handleRestoreListFromRelay(kind)}
                            disabled={restoring || !backup || !session}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {restoring ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <Download size={14} />
                            )}
                            Restore from Relays
                          </button>
                          <button
                            onClick={() => loadListRelayBackup(kind)}
                            disabled={loading}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
                            title="Refresh relay backup status"
                          >
                            <RefreshCw
                              size={14}
                              className={loading ? "animate-spin" : ""}
                            />
                          </button>
                        </div>

                        {queried.length > 0 && (
                          <div className="mt-2">
                            <button
                              onClick={() =>
                                setShowListRelayDetails((prev) => ({
                                  ...prev,
                                  [kind]: !prev[kind],
                                }))
                              }
                              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                            >
                              {showDetails ? (
                                <ChevronUp size={12} />
                              ) : (
                                <ChevronDown size={12} />
                              )}
                              <span>
                                {showDetails ? "Hide" : "Show"} relays (
                                {found.length}/{queried.length} have backup)
                              </span>
                            </button>
                            {showDetails && (
                              <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                                <ul className="text-xs space-y-1">
                                  {queried.map((relay) => {
                                    const has = found.includes(relay);
                                    return (
                                      <li
                                        key={relay}
                                        className={`truncate flex items-center gap-2 ${
                                          has
                                            ? "text-green-600 dark:text-green-400"
                                            : "text-gray-400 dark:text-gray-500"
                                        }`}
                                      >
                                        {has ? (
                                          <CheckCircle
                                            size={10}
                                            className="flex-shrink-0"
                                          />
                                        ) : (
                                          <CloudOff
                                            size={10}
                                            className="flex-shrink-0"
                                          />
                                        )}
                                        {relay}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Backups List */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Local Backup History
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 mb-3">
          Snapshots saved in this browser. Download any entry as JSON for offline
          safekeeping, or restore it to publish back to your relays.
        </p>
      </div>
      {filteredBackups.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
          <Archive className="mx-auto text-gray-400 mb-4" size={48} />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No backups found
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Create your first backup to get started
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBackups.map((backup) => (
            <div
              key={backup.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 sm:p-4 hover:shadow-md transition-shadow"
            >
              {(() => {
                const meta = BACKUP_TYPE_META[backup.type];
                const RowIcon = meta?.icon || Archive;
                return (
              <div className="flex items-start justify-between gap-2 sm:gap-4">
                <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                  <div
                    className={`p-2 rounded-lg flex-shrink-0 ${meta?.badgeBg || "bg-gray-100 dark:bg-gray-700"}`}
                  >
                    <RowIcon
                      className={
                        meta?.iconColor || "text-gray-600 dark:text-gray-400"
                      }
                      size={20}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {meta?.label || backup.type}
                      </h3>
                      <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        ({getBackupItemCount(backup)} items)
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-gray-600 dark:text-gray-400">
                      <div className="flex items-center gap-1">
                        <Calendar size={14} />
                        <span className="text-xs sm:text-sm">
                          {formatDate(backup.createdAt)}
                        </span>
                      </div>
                      {backup.notes && (
                        <div className="flex items-center gap-1 min-w-0">
                          <FileText size={14} className="flex-shrink-0" />
                          <span className="truncate text-xs sm:text-sm">
                            {backup.notes}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-1 sm:gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleRestoreBackup(backup)}
                    className="p-2 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                    title="Restore and publish this backup"
                  >
                    <RefreshCw size={18} />
                  </button>
                  <button
                    onClick={() => handleExportBackup(backup)}
                    className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                    title="Download backup"
                  >
                    <Download size={18} />
                  </button>
                  <button
                    onClick={() => handleDeleteBackup(backup.id)}
                    className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Delete backup"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
