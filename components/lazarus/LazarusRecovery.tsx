"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyEvent, type Event } from "nostr-tools";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileJson,
  HardDrive,
  Info,
  Loader2,
  RefreshCw,
  ScanSearch,
  Upload,
  XCircle,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { DEFAULT_RELAYS } from "@/lib/nostr";
import { backupService } from "@/lib/backupService";
import { getErrorMessage } from "@/lib/utils/format";
import {
  applyLazarusPrivateTags,
  buildExportBundle,
  buildLazarusRecoveryDraft,
  checkLazarusCurrent,
  computeLazarusDelta,
  computeLazarusProfileChanges,
  countItemTags,
  createLazarusRelaySource,
  downloadJson,
  fetchLatestVersions,
  fetchLazarusVersionsFrom,
  fitsLazarusRemoteRestore,
  fitsNip46Request,
  getContentEncryption,
  getLazarusKindProfile,
  getLazarusKindProfiles,
  getLazarusScanPlan,
  groupLazarusCandidates,
  isPastEmptyVersion,
  LAZARUS_ARCHIVAL_RELAYS,
  lazarusFileName,
  lazarusScanReachedNoRelay,
  listArchive,
  loadOlderLazarusVersions,
  mergeLazarusRetry,
  muteListFromTags,
  parseImportedEvents,
  parsePrivateTags,
  parseRelayListEvent,
  profileFromEvent,
  publishLazarusRecovery,
  readLazarusCurrent,
  relayListMetadataFromEvent,
  removeFromArchive,
  resolveLazarusRelays,
  saveToArchive,
  scanLazarusKind,
  sortLazarusCandidates,
  type LazarusArchiveEntry,
  type LazarusCandidate,
  type LazarusItemCount,
  type LazarusKindProfile,
  type LazarusRelayConfig,
  type LazarusScanResult,
  type LazarusSortOrder,
} from "@/lib/lazarus";
import LazarusReviewDialog, { type LazarusReview } from "./LazarusReviewDialog";
import {
  LazarusVersionGroup,
  LazarusVersionRow,
  type PrivateItemsNote,
} from "./LazarusVersionRow";
import { formatDate, shortRelay } from "./format";

const KIND_PROFILES = getLazarusKindProfiles();
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const KIND_DESCRIPTIONS: Record<number, string> = {
  3: "Who you follow",
  10000: "Accounts, words, hashtags, and threads you mute",
  0: "Your name, picture, bio, and other profile fields",
  10003: "Notes and articles you saved",
  10044: "Keys clients use to encrypt DMs to you (NIP-4e)",
  10002: "Where clients read and publish your notes (NIP-65)",
  10050: "Where you receive private DMs (NIP-17)",
  10006: "Relays you chose to block",
};

type Phase = "idle" | "scanning" | "done" | "error";

interface KindState {
  phase: Phase;
  scan?: LazarusScanResult;
  error?: string;
  loadingOlder?: boolean;
  retrying?: boolean;
}

interface Banner {
  tone: "success" | "error";
  text: string;
}

interface LazarusRecoveryProps {
  onBackupsChanged?: () => void;
}

export default function LazarusRecovery({
  onBackupsChanged,
}: LazarusRecoveryProps) {
  const session = useStore((state) => state.session);
  const signer = useStore((state) => state.signer);
  const pubkey = session?.pubkey;
  const usesRemoteSigner = session?.signerType === "nip46";

  const [selectedKind, setSelectedKind] = useState(3);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [kinds, setKinds] = useState<Record<number, KindState>>({});
  const [privateTags, setPrivateTags] = useState<Map<string, string[][]>>(
    new Map(),
  );
  const [privateNotes, setPrivateNotes] = useState<
    Record<string, PrivateItemsNote>
  >({});
  const [decryptingIds, setDecryptingIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<LazarusSortOrder>("date");
  const [showEmpty, setShowEmpty] = useState(false);
  const [showRelays, setShowRelays] = useState(false);
  const [archive, setArchive] = useState<LazarusArchiveEntry[]>([]);
  const [review, setReview] = useState<LazarusReview | null>(null);
  const [preparingId, setPreparingId] = useState<string>();
  const [banner, setBanner] = useState<Banner | null>(null);
  const [exporting, setExporting] = useState(false);

  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const scanIds = useRef<Record<number, number>>({});
  const privateTagsRef = useRef(new Map<string, string[][]>());
  const privateNotesRef = useRef<Record<string, PrivateItemsNote>>({});
  const decryptQueue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(new Set<string>());
  const restoreFits = useRef(new Map<string, boolean>());
  const reviewKey = useRef(0);

  const relayConfig = useMemo<LazarusRelayConfig>(() => {
    const meta = session?.relayListMetadata;
    return {
      defaultRelays: DEFAULT_RELAYS,
      archivalRelays: LAZARUS_ARCHIVAL_RELAYS,
      ownRelayList: meta
        ? {
            read: [...meta.both, ...meta.read],
            write: [...meta.both, ...meta.write],
            createdAt: meta.timestamp,
          }
        : undefined,
    };
  }, [session?.relayListMetadata]);
  const source = useMemo(
    () => createLazarusRelaySource(relayConfig),
    [relayConfig],
  );

  const profile = getLazarusKindProfile(selectedKind) ?? KIND_PROFILES[0];
  const kindState: KindState = kinds[selectedKind] ?? { phase: "idle" };
  const scan = kindState.scan;
  const sortable = profile.ranking === "count";

  const reloadArchive = useCallback(() => {
    setArchive(pubkey ? listArchive(pubkey) : []);
  }, [pubkey]);

  // A scan belongs to the account it ran for.
  useEffect(() => {
    scanIds.current = {};
    privateTagsRef.current = new Map();
    privateNotesRef.current = {};
    queued.current = new Set();
    restoreFits.current = new Map();
    setKinds({});
    setPrivateTags(new Map());
    setPrivateNotes({});
    setDecryptingIds(new Set());
    setExpandedGroups(new Set());
    setReview(null);
    setBanner(null);
    reloadArchive();
  }, [pubkey, reloadArchive]);

  const updateKind = useCallback(
    (
      kind: number,
      patch: Partial<KindState> | ((prev: KindState) => KindState),
    ) => {
      setKinds((prev) => {
        const current = prev[kind] ?? { phase: "idle" as Phase };
        const next =
          typeof patch === "function"
            ? patch(current)
            : { ...current, ...patch };
        return { ...prev, [kind]: next };
      });
    },
    [],
  );

  const itemCountFor = useCallback(
    (kindProfile: LazarusKindProfile, event: Event): LazarusItemCount => {
      const base = kindProfile.itemCount(event);
      const tags = privateTagsRef.current.get(event.id);
      if (!tags || !kindProfile.privateItemTypes) return base;
      return {
        count: base.count,
        partial: false,
        privateCount: countItemTags(tags, kindProfile.privateItemTypes),
      };
    },
    [],
  );

  const isTooLargeToRestore = useCallback(
    (event: Event) => {
      if (!usesRemoteSigner || !pubkey) return false;
      let fits = restoreFits.current.get(event.id);
      if (fits === undefined) {
        fits = fitsLazarusRemoteRestore(event, pubkey);
        restoreFits.current.set(event.id, fits);
      }
      return !fits;
    },
    [usesRemoteSigner, pubkey],
  );

  const readPrivateTags = useCallback(
    async (
      event: Event,
    ): Promise<string[][] | PrivateItemsNote | undefined> => {
      const encryption = getContentEncryption(event.content);
      if (!encryption) return undefined;
      const activeSigner = useStore.getState().signer;
      // Without a signer yet, leave it undecrypted and try again once connected.
      if (!activeSigner) return undefined;
      const method = encryption === "nip04" ? "nip04_decrypt" : "nip44_decrypt";
      if (
        usesRemoteSigner &&
        !fitsNip46Request(method, [event.pubkey, event.content])
      ) {
        return "too-large";
      }
      if (encryption === "nip44" && !activeSigner.nip44Decrypt)
        return "unsupported";
      const plainText =
        encryption === "nip04"
          ? await activeSigner.nip04Decrypt(event.pubkey, event.content)
          : await activeSigner.nip44Decrypt!(event.pubkey, event.content);
      if (typeof plainText !== "string") return "failed";
      return parsePrivateTags(plainText) ?? "failed";
    },
    [usesRemoteSigner],
  );

  const isUndecrypted = useCallback(
    (event: Event) =>
      !!getContentEncryption(event.content) &&
      !privateTagsRef.current.has(event.id) &&
      !privateNotesRef.current[event.id],
    [],
  );

  const mergePrivate = useCallback(
    (
      decrypted: Map<string, string[][]>,
      notes: Record<string, PrivateItemsNote>,
    ) => {
      if (decrypted.size === 0 && Object.keys(notes).length === 0) return;
      const merged = new Map([...privateTagsRef.current, ...decrypted]);
      privateTagsRef.current = merged;
      privateNotesRef.current = { ...privateNotesRef.current, ...notes };
      setPrivateTags(merged);
      setPrivateNotes(privateNotesRef.current);
      setKinds((prev) => {
        const next = { ...prev };
        for (const [key, state] of Object.entries(prev)) {
          const kindProfile = getLazarusKindProfile(Number(key));
          if (state.scan && kindProfile?.privateItemTypes) {
            next[Number(key)] = {
              ...state,
              scan: applyLazarusPrivateTags(kindProfile, state.scan, merged),
            };
          }
        }
        return next;
      });
    },
    [],
  );

  // One decryption at a time, so a signer that prompts never gets two requests.
  const decryptVersions = useCallback(
    (events: Event[]): Promise<void> => {
      const pending = events.filter(
        (event) => isUndecrypted(event) && !queued.current.has(event.id),
      );
      if (pending.length === 0) return decryptQueue.current;
      const ids = pending.map((event) => event.id);
      ids.forEach((id) => queued.current.add(id));
      setDecryptingIds((prev) => new Set([...prev, ...ids]));
      const job = decryptQueue.current.then(async () => {
        const decrypted = new Map<string, string[][]>();
        const notes: Record<string, PrivateItemsNote> = {};
        for (const event of pending) {
          if (!isUndecrypted(event)) continue;
          try {
            const result = await readPrivateTags(event);
            if (result === undefined) continue;
            if (typeof result === "string") notes[event.id] = result;
            else decrypted.set(event.id, result);
          } catch {
            notes[event.id] = "failed";
          }
        }
        mergePrivate(decrypted, notes);
      });
      const settled = job
        .catch(() => {})
        .finally(() => {
          ids.forEach((id) => queued.current.delete(id));
          setDecryptingIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
          });
        });
      decryptQueue.current = settled;
      return settled;
    },
    [isUndecrypted, readPrivateTags, mergePrivate],
  );

  const retryDecrypt = useCallback(
    (candidate: LazarusCandidate) => {
      const notes = { ...privateNotesRef.current };
      delete notes[candidate.event.id];
      privateNotesRef.current = notes;
      setPrivateNotes(notes);
      void decryptVersions([candidate.event]);
    },
    [decryptVersions],
  );

  const runScan = useCallback(
    async (kind: number): Promise<LazarusScanResult | undefined> => {
      if (!pubkey) return undefined;
      const scanId = (scanIds.current[kind] ?? 0) + 1;
      scanIds.current[kind] = scanId;
      updateKind(kind, { phase: "scanning", error: undefined });
      try {
        const result = await scanLazarusKind(kind, pubkey, source);
        if (scanIds.current[kind] !== scanId) return undefined;
        const kindProfile = getLazarusKindProfile(kind)!;
        const ranked = applyLazarusPrivateTags(
          kindProfile,
          result,
          privateTagsRef.current,
        );
        updateKind(kind, { phase: "done", scan: ranked });
        return ranked;
      } catch (error) {
        if (scanIds.current[kind] === scanId) {
          updateKind(kind, { phase: "error", error: getErrorMessage(error) });
        }
        return undefined;
      }
    },
    [pubkey, source, updateKind],
  );

  const retryFailedRelays = useCallback(
    async (kind: number) => {
      const state = kindsRef.current[kind];
      if (!state?.scan || !pubkey) return;
      const failed = Object.entries(state.scan.relayOutcomes ?? {})
        .filter(([, outcome]) => outcome !== "answered")
        .map(([url]) => url);
      if (failed.length === 0) return;
      const scanId = scanIds.current[kind];
      updateKind(kind, { retrying: true });
      try {
        const retry = await fetchLazarusVersionsFrom(
          kind,
          pubkey,
          failed,
          relayConfig,
        );
        if (scanIds.current[kind] !== scanId) return;
        const kindProfile = getLazarusKindProfile(kind)!;
        updateKind(kind, (prev) => ({
          ...prev,
          retrying: false,
          scan: prev.scan
            ? mergeLazarusRetry(
                kindProfile,
                prev.scan,
                retry,
                privateTagsRef.current,
              )
            : prev.scan,
        }));
      } catch {
        updateKind(kind, { retrying: false });
      }
    },
    [pubkey, relayConfig, updateKind],
  );

  const loadOlder = useCallback(async () => {
    const state = kindsRef.current[selectedKind];
    if (!state?.scan || !pubkey) return;
    const kind = selectedKind;
    const scanId = scanIds.current[kind];
    updateKind(kind, { loadingOlder: true });
    try {
      const kindProfile = getLazarusKindProfile(kind)!;
      const result = await loadOlderLazarusVersions(
        kindProfile,
        state.scan,
        pubkey,
        source,
        privateTagsRef.current,
      );
      if (scanIds.current[kind] !== scanId) return;
      updateKind(kind, {
        loadingOlder: false,
        scan: applyLazarusPrivateTags(
          kindProfile,
          result,
          privateTagsRef.current,
        ),
      });
    } catch (error) {
      updateKind(kind, { loadingOlder: false });
      setBanner({
        tone: "error",
        text: `Couldn't load older versions: ${getErrorMessage(error)}`,
      });
    }
  }, [selectedKind, pubkey, source, updateKind]);

  const listItems = useMemo(
    () =>
      scan
        ? groupLazarusCandidates(scan, profile, { hidePastEmpty: !showEmpty })
        : [],
    [scan, profile, showEmpty],
  );
  const bySize = useMemo(
    () =>
      scan && sortable && sortBy === "size"
        ? sortLazarusCandidates(scan.candidates, "size").filter(
            (candidate) => showEmpty || !isPastEmptyVersion(candidate, profile),
          )
        : undefined,
    [scan, sortable, sortBy, showEmpty, profile],
  );
  const pastEmptyCount = useMemo(
    () =>
      scan
        ? scan.candidates.filter((c) => isPastEmptyVersion(c, profile)).length
        : 0,
    [scan, profile],
  );
  const archiveForKind = useMemo(
    () => archive.filter((entry) => entry.event.kind === selectedKind),
    [archive, selectedKind],
  );

  // Decrypt what's on screen: single rows, expanded groups (except over NIP-46,
  // where each is a signer request), the recommendation, and saved versions.
  useEffect(() => {
    if (!profile.privateItemTypes || !signer) return;
    const shown: Event[] = listItems.flatMap((item) => {
      if (item.type === "version") return [item.candidate.event];
      if (
        usesRemoteSigner ||
        !expandedGroups.has(item.candidates[0].event.id)
      ) {
        return [];
      }
      return item.candidates.map((c) => c.event);
    });
    if (scan?.recommended) shown.push(scan.recommended.event);
    archiveForKind.forEach((entry) => shown.push(entry.event));
    void decryptVersions(shown);
  }, [
    scan,
    listItems,
    profile,
    expandedGroups,
    usesRemoteSigner,
    signer,
    archiveForKind,
    decryptVersions,
  ]);

  const restoreBlockers = useCallback(
    (kindProfile: LazarusKindProfile, event: Event): string[] => {
      const blockers: string[] = [];
      if (!useStore.getState().signer) {
        blockers.push(
          "Connect your signer to restore. Scanning works without it.",
        );
      }
      if (event.pubkey !== pubkey) {
        blockers.push("This version belongs to another account.");
      }
      if (isTooLargeToRestore(event)) {
        blockers.push(
          "This version is too large to sign with a remote signer: NIP-46 requests are limited to 64 KB. Sign in with a browser extension (NIP-07) to restore it.",
        );
      }
      if (
        kindProfile.kind === 10000 &&
        getContentEncryption(event.content) &&
        !privateTagsRef.current.has(event.id)
      ) {
        blockers.push(
          "Mutable needs to read this version's private mutes to keep your mute list in sync after the restore, and couldn't decrypt them. Close this review and try decrypting again.",
        );
      }
      return blockers;
    },
    [pubkey, isTooLargeToRestore],
  );

  const buildReview = useCallback(
    (
      kindProfile: LazarusKindProfile,
      chosen: Event,
      current: Event | undefined,
      kindScan: LazarusScanResult,
      extras: { originLabel?: string; changedSinceReview: boolean },
    ): LazarusReview => {
      const fromScan = kindScan.candidates.find(
        (c) => c.event.id === chosen.id,
      );
      const candidate: LazarusCandidate = {
        event: chosen,
        foundOn: fromScan?.foundOn ?? [],
        itemCount: itemCountFor(kindProfile, chosen),
        isCurrent: false,
        isRecommended: fromScan?.isRecommended ?? false,
      };
      reviewKey.current += 1;
      return {
        key: reviewKey.current,
        profile: kindProfile,
        candidate,
        originLabel: extras.originLabel,
        current,
        currentItemCount: current
          ? itemCountFor(kindProfile, current)
          : undefined,
        delta: computeLazarusDelta(chosen, current, privateTagsRef.current),
        profileChanges:
          kindProfile.kind === 0
            ? computeLazarusProfileChanges(chosen, current)
            : undefined,
        changedSinceReview: extras.changedSinceReview,
        blockers: restoreBlockers(kindProfile, chosen),
        unsavedMuteChanges:
          kindProfile.kind === 10000 && useStore.getState().hasUnsavedChanges,
        writeRelaysAreDefaults: kindScan.relayList === "missing",
        status: "review",
        attempts: 0,
      };
    },
    [itemCountFor, restoreBlockers],
  );

  const openReview = useCallback(
    async (kind: number, candidate: LazarusCandidate, originLabel?: string) => {
      if (!pubkey || preparingId) return;
      const kindProfile = getLazarusKindProfile(kind)!;
      setPreparingId(candidate.event.id);
      try {
        let kindScan = kindsRef.current[kind]?.scan;
        if (!kindScan) {
          // A saved version is compared against what's on relays now.
          kindScan = await runScan(kind);
          if (!kindScan) {
            setBanner({
              tone: "error",
              text: "Couldn't scan your relays to find your current version, so this version can't be reviewed yet.",
            });
            return;
          }
        }
        const current = kindScan.current?.event;
        if (kindProfile.privateItemTypes) {
          await decryptVersions(
            current ? [candidate.event, current] : [candidate.event],
          );
        }
        setReview(
          buildReview(kindProfile, candidate.event, current, kindScan, {
            originLabel,
            changedSinceReview: false,
          }),
        );
      } finally {
        setPreparingId(undefined);
      }
    },
    [pubkey, preparingId, runScan, decryptVersions, buildReview],
  );

  const reviewAgainst = useCallback(
    async (open: LazarusReview, newer: Event) => {
      const kindProfile = open.profile;
      if (kindProfile.privateItemTypes) await decryptVersions([newer]);
      const kindScan = kindsRef.current[kindProfile.kind]?.scan;
      if (!kindScan) return;
      setReview(
        buildReview(kindProfile, open.candidate.event, newer, kindScan, {
          originLabel: open.originLabel,
          changedSinceReview: true,
        }),
      );
    },
    [decryptVersions, buildReview],
  );

  const snapshotBeforeRestore = useCallback(
    (event: Event) => {
      if (!pubkey) return;
      saveToArchive([
        {
          event,
          source: "snapshot",
          label: "Saved before a restore",
          savedAt: Date.now(),
        },
      ]);
      // The Local Backup History keeps getting its usual auto-snapshots too.
      const note = "Auto-snapshot before relay history restore";
      if (event.kind === 10000) {
        const tags = privateTagsRef.current.get(event.id);
        if (!getContentEncryption(event.content) || tags) {
          backupService.saveBackup(
            backupService.createMuteListBackup(
              pubkey,
              muteListFromTags(event.tags, tags ?? []),
              note,
              event.id,
            ),
          );
        }
      } else if (event.kind === 3) {
        const follows = event.tags
          .filter((t) => t[0] === "p" && t[1])
          .map((t) => t[1]);
        backupService.saveBackup(
          backupService.createFollowListBackup(pubkey, follows, note, event.id),
        );
      }
      reloadArchive();
      onBackupsChanged?.();
    },
    [pubkey, onBackupsChanged, reloadArchive],
  );

  // The next edit in Mutable must build on the restored version.
  const applyRestoreLocally = useCallback(
    (signed: Event, chosenPrivate?: string[][]) => {
      const store = useStore.getState();
      if (signed.kind === 10000) {
        store.setMuteList(muteListFromTags(signed.tags, chosenPrivate ?? []));
        store.setHasUnsavedChanges(false);
        store.setMuteListLastFetched(Date.now());
      } else if (signed.kind === 0) {
        store.setUserProfile(profileFromEvent(signed));
      } else if (signed.kind === 10002 && store.session) {
        const meta = relayListMetadataFromEvent(signed);
        const write = [...meta.both, ...meta.write];
        store.setSession({
          ...store.session,
          relays: write.length > 0 ? write : store.session.relays,
          relayListMetadata: meta,
        });
      }
    },
    [],
  );

  const confirmRestore = useCallback(
    async (override: boolean) => {
      const open = reviewRef.current;
      if (!open || !pubkey) return;
      const kind = open.profile.kind;
      const kindScan = kindsRef.current[kind]?.scan;
      const chosen = open.candidate.event;
      const patch = (update: Partial<LazarusReview>) =>
        setReview((prev) =>
          prev && prev.key === open.key ? { ...prev, ...update } : prev,
        );

      patch({
        status: "working",
        step: "Checking your account…",
        error: undefined,
      });
      try {
        const activeSigner = useStore.getState().signer;
        if (!activeSigner) {
          throw new Error(
            "Your signer isn't connected. Reconnect it and try again.",
          );
        }
        const signerPubkey = await activeSigner.getPublicKey();
        if (signerPubkey !== pubkey || chosen.pubkey !== pubkey) {
          throw new Error(
            "This version belongs to another account. Switch back to it to restore.",
          );
        }
        // A mute list restore replaces Mutable's own copy, which can hold
        // edits that were never published: they'd be lost without a word.
        if (kind === 10000 && useStore.getState().hasUnsavedChanges) {
          throw new Error(
            "You have mute list changes that aren't published yet. Publish or discard them first, since restoring replaces them.",
          );
        }

        let writeRelays = kindScan?.writeRelays ?? [];
        let replacing = open.current;
        if (!override) {
          patch({
            step: "Confirming your current version on your write relays…",
          });
          if (writeRelays.length === 0) {
            const resolved = await resolveLazarusRelays(pubkey, relayConfig);
            writeRelays = resolved.write;
          }
          const answers = await readLazarusCurrent(kind, pubkey, writeRelays);
          const check = checkLazarusCurrent(open.current, undefined, answers);
          if (check.status === "unconfirmed") {
            setReview((prev) =>
              prev && prev.key === open.key
                ? {
                    ...prev,
                    status: "unconfirmed",
                    step: undefined,
                    attempts: prev.attempts + 1,
                    rereadAnswers: answers,
                  }
                : prev,
            );
            return;
          }
          if (check.status === "changed") {
            await reviewAgainst(open, check.current);
            return;
          }
          replacing = check.current;
        }

        patch({ step: "Waiting for your signer…" });
        const draft = buildLazarusRecoveryDraft(chosen, { current: replacing });
        const signed = await activeSigner.signEvent(draft);
        if (
          signed.pubkey !== pubkey ||
          useStore.getState().session?.pubkey !== pubkey ||
          !verifyEvent(signed)
        ) {
          throw new Error(
            "The signed event doesn't match this account, so it wasn't published.",
          );
        }

        if (writeRelays.length === 0) {
          writeRelays = (await resolveLazarusRelays(pubkey, relayConfig)).write;
        }
        let successRelays = writeRelays;
        let extraRelays = kindScan?.respondingRelays ?? [];
        if (kind === 10002) {
          const restoredWrite = parseRelayListEvent(signed).write;
          if (restoredWrite.length > 0) {
            successRelays = restoredWrite;
            extraRelays = [...extraRelays, ...writeRelays];
          }
        }
        if (successRelays.length === 0) {
          throw new Error(
            "No write relays are known for your account, so there's nowhere to publish. Scan again once your relays answer.",
          );
        }

        // Signed and ready: the version about to be replaced is saved first.
        if (replacing) snapshotBeforeRestore(replacing);

        patch({ step: "Publishing to your write relays…" });
        const outcome = await publishLazarusRecovery(
          signed,
          successRelays,
          extraRelays,
        );
        if (!outcome.accepted) {
          patch({
            status: "failed",
            step: undefined,
            writeResults: outcome.write,
            error: "No write relay accepted the restore, so nothing changed.",
          });
          return;
        }

        applyRestoreLocally(signed, privateTagsRef.current.get(chosen.id));
        patch({
          status: "published",
          step: undefined,
          writeResults: outcome.write,
          extraPending: true,
        });
        outcome.extra
          .then((results) =>
            patch({ extraResults: results, extraPending: false }),
          )
          .catch(() => patch({ extraPending: false }));
        reloadArchive();
        void runScan(kind);
      } catch (error) {
        patch({
          status: open.status === "unconfirmed" ? "unconfirmed" : "review",
          step: undefined,
          error: getErrorMessage(error),
        });
      }
    },
    [
      pubkey,
      relayConfig,
      reviewAgainst,
      snapshotBeforeRestore,
      applyRestoreLocally,
      reloadArchive,
      runScan,
    ],
  );

  const closeReview = useCallback(() => {
    if (reviewRef.current?.status === "working") return;
    setReview(null);
  }, []);

  const downloadVersions = useCallback(
    (label: string, events: Event[]) => {
      if (!pubkey || events.length === 0) return;
      downloadJson(
        lazarusFileName(label, pubkey),
        buildExportBundle(pubkey, events),
      );
    },
    [pubkey],
  );

  const exportData = useCallback(async () => {
    if (!pubkey) return;
    setExporting(true);
    setBanner(null);
    try {
      const plan = await getLazarusScanPlan(pubkey, relayConfig);
      const { events } = await fetchLatestVersions(
        pubkey,
        KIND_PROFILES.map((p) => p.kind),
        plan.relays,
      );
      if (events.length === 0) {
        setBanner({
          tone: "error",
          text: "No data found on the relays that answered.",
        });
        return;
      }
      downloadVersions("nostr data", events);
      const found = events
        .map((e) => getLazarusKindProfile(e.kind)?.name)
        .join(", ");
      const missing = KIND_PROFILES.filter(
        (p) => !events.some((e) => e.kind === p.kind),
      ).map((p) => p.name);
      setBanner({
        tone: "success",
        text: `Downloaded ${events.length} signed ${events.length === 1 ? "event" : "events"}: ${found}.${
          missing.length > 0 ? ` Not found: ${missing.join(", ")}.` : ""
        }`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        text: `Couldn't export your data: ${getErrorMessage(error)}`,
      });
    } finally {
      setExporting(false);
    }
  }, [pubkey, relayConfig, downloadVersions]);

  const importFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !pubkey) return;
      if (file.size > MAX_IMPORT_BYTES) {
        setBanner({
          tone: "error",
          text: `${file.name} is larger than 10 MB.`,
        });
        return;
      }
      try {
        const result = parseImportedEvents(await file.text(), pubkey);
        const added = saveToArchive(
          result.events.map((imported) => ({
            event: imported,
            source: "import" as const,
            label: file.name,
            savedAt: Date.now(),
          })),
        );
        reloadArchive();
        const skipped = [
          result.foreign > 0 && `${result.foreign} from other accounts`,
          result.invalid > 0 && `${result.invalid} invalid or tampered`,
          result.unsupported > 0 &&
            `${result.unsupported} of kinds this can't restore`,
        ].filter(Boolean);
        const skippedText =
          skipped.length > 0 ? ` Skipped ${skipped.join(", ")}.` : "";
        if (result.events.length === 0) {
          setBanner({
            tone: "error",
            text: `No restorable versions for this account in ${file.name}.${skippedText}`,
          });
          return;
        }
        const counts = new Map<string, number>();
        result.events.forEach((e) => {
          const name = getLazarusKindProfile(e.kind)?.name ?? `kind ${e.kind}`;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        });
        const summary = Array.from(
          counts,
          ([name, count]) => `${name} ${count}`,
        ).join(", ");
        const already = result.events.length - added;
        setBanner({
          tone: "success",
          text: `Imported ${added} new ${added === 1 ? "version" : "versions"} from ${file.name} (${summary}).${
            already > 0
              ? ` ${already} ${already === 1 ? "was" : "were"} already saved.`
              : ""
          }${skippedText} Find them under "Saved on this device" for each list.`,
        });
        const firstKind = result.events[0].kind;
        setSelectedKind(firstKind);
        if (getLazarusKindProfile(firstKind)?.tier === 3) setShowAdvanced(true);
      } catch (error) {
        setBanner({ tone: "error", text: getErrorMessage(error) });
      }
    },
    [pubkey, reloadArchive],
  );

  const deleteSaved = useCallback(
    (entry: LazarusArchiveEntry) => {
      if (!confirm("Remove this saved version from this device?")) return;
      removeFromArchive(entry.event.id);
      reloadArchive();
    },
    [reloadArchive],
  );

  const selectKind = (kind: number) => {
    setSelectedKind(kind);
    setExpandedGroups(new Set());
    setShowEmpty(false);
    setShowRelays(false);
    setSortBy("date");
  };

  const canRestore = !!signer;

  const renderCandidate = (candidate: LazarusCandidate) => (
    <LazarusVersionRow
      key={candidate.event.id}
      profile={profile}
      candidate={candidate}
      note={privateNotes[candidate.event.id]}
      decrypting={
        decryptingIds.has(candidate.event.id) &&
        !privateTags.has(candidate.event.id)
      }
      tooLargeToRestore={isTooLargeToRestore(candidate.event)}
      restorable={canRestore && !isPastEmptyVersion(candidate, profile)}
      preparing={preparingId === candidate.event.id}
      onReview={(c) => openReview(selectedKind, c)}
      onDownload={(c) =>
        downloadVersions(`${profile.name} ${formatDate(c.event.created_at)}`, [
          c.event,
        ])
      }
      onRetryDecrypt={retryDecrypt}
    />
  );

  if (!pubkey) return null;

  const outcomes = scan?.relayOutcomes ?? {};
  const answeredCount = Object.values(outcomes).filter(
    (o) => o === "answered",
  ).length;
  const unansweredCount = Object.keys(outcomes).length - answeredCount;
  const writeSet = new Set(scan?.writeRelays ?? []);
  const primaryKinds = KIND_PROFILES.filter((p) => p.tier < 3);
  const advancedKinds = KIND_PROFILES.filter((p) => p.tier === 3);

  const kindChip = (kindProfile: LazarusKindProfile) => {
    const saved = archive.filter(
      (e) => e.event.kind === kindProfile.kind,
    ).length;
    const hasFix = !!kinds[kindProfile.kind]?.scan?.recommended;
    const active = kindProfile.kind === selectedKind;
    return (
      <button
        key={kindProfile.kind}
        type="button"
        onClick={() => selectKind(kindProfile.kind)}
        aria-pressed={active}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
          active
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        }`}
      >
        {kindProfile.name}
        {hasFix && (
          <span
            className={`h-2 w-2 rounded-full ${active ? "bg-white" : "bg-emerald-500"}`}
            title="A restore is recommended"
          />
        )}
        {saved > 0 && (
          <span
            className={`rounded px-1 text-[11px] ${
              active ? "bg-emerald-700" : "bg-gray-200 dark:bg-gray-700"
            }`}
            title={`${saved} saved on this device`}
          >
            {saved}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      id="lazarus-recovery"
      className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
    >
      <div className="flex items-start gap-4">
        <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
          <ArchiveRestore
            className="text-emerald-600 dark:text-emerald-400"
            size={24}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Recover from relay history
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Relays often keep older versions of your lists and profile after a
            client overwrites them. Scan for those versions and restore one.
            Unlike relay backups, this needs no backup made in advance. Scans
            are read-only: nothing is published until you review the change and
            confirm.
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Follows the{" "}
            <a
              href="https://github.com/dmnyc/lazarus"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-900 dark:hover:text-white"
            >
              Lazarus
            </a>{" "}
            recovery spec (0.6.0-draft).
          </p>

          {banner && (
            <div
              className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
                banner.tone === "success"
                  ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200"
                  : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
              }`}
            >
              {banner.tone === "success" ? (
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle size={16} className="mt-0.5 flex-shrink-0" />
              )}
              <span className="min-w-0 flex-1">{banner.text}</span>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="text-xs underline"
              >
                Dismiss
              </button>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
              <FileJson size={16} />
              Your events as JSON
            </div>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Download the newest signed version of each list below to keep
              offline. Import a file later to review and restore any version it
              holds. Imports are checked: only versions signed by this account
              are kept.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportData}
                disabled={exporting}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {exporting ? "Collecting your data…" : "Download my data"}
              </button>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">
                <Upload size={16} />
                Import JSON
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={importFile}
                  className="hidden"
                  data-testid="lazarus-import"
                />
              </label>
            </div>
          </div>

          {usesRemoteSigner && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              You&apos;re signed in with a remote signer. Lists over 64 KB, like
              a mute list with many private items or a big follow list,
              can&apos;t be decrypted or restored through NIP-46. Use a browser
              extension (NIP-07) for those.
            </div>
          )}
          {!canRestore && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-gray-200 p-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              Your signer isn&apos;t connected, so you can scan and download
              versions but not restore them yet.
            </div>
          )}

          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Choose what to recover
            </div>
            <div className="flex flex-wrap gap-2">
              {primaryKinds.map(kindChip)}
              <button
                type="button"
                onClick={() => setShowAdvanced((shown) => !shown)}
                aria-expanded={showAdvanced}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                Advanced
                {showAdvanced ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>
            </div>
            {showAdvanced && (
              <div className="mt-2 flex flex-wrap gap-2">
                {advancedKinds.map(kindChip)}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="font-medium text-gray-900 dark:text-white">
              {profile.name}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {KIND_DESCRIPTIONS[profile.kind]}
            </div>

            {profile.tier === 3 && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                Advanced: an old relay list can point at relays that no longer
                exist and quietly break delivery.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => runScan(selectedKind)}
                disabled={kindState.phase === "scanning"}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {kindState.phase === "scanning" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ScanSearch size={16} />
                )}
                {kindState.phase === "scanning"
                  ? "Scanning…"
                  : kindState.phase === "idle"
                    ? "Scan relays"
                    : "Scan again"}
              </button>
              {kindState.phase === "idle" && (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Checks your relays, Mutable&apos;s default relays, and
                  archival relays for every version that survives.
                </span>
              )}
              {kindState.phase === "scanning" && (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Asking your relays, the defaults, and archival relays…
                </span>
              )}
            </div>

            {kindState.phase === "error" && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                <XCircle size={16} className="mt-0.5 flex-shrink-0" />
                The scan failed: no relay answered. Check your connection and
                scan again.
              </div>
            )}

            {kindState.phase === "done" && scan && (
              <div className="mt-3 space-y-3">
                {scan.relayOutcomes && (
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowRelays((shown) => !shown)}
                        aria-expanded={showRelays}
                        className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white"
                      >
                        {answeredCount} of {scan.queriedRelays.length} relays
                        answered
                        {showRelays ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </button>
                      {unansweredCount > 0 && (
                        <button
                          type="button"
                          onClick={() => retryFailedRelays(selectedKind)}
                          disabled={kindState.retrying}
                          className="flex items-center gap-1 underline hover:text-gray-900 disabled:opacity-50 dark:hover:text-white"
                        >
                          <RefreshCw
                            size={12}
                            className={kindState.retrying ? "animate-spin" : ""}
                          />
                          Retry {unansweredCount}{" "}
                          {unansweredCount === 1 ? "relay" : "relays"}
                        </button>
                      )}
                    </div>
                    {showRelays && (
                      <ul className="mt-2 space-y-0.5">
                        {scan.queriedRelays.map((url) => (
                          <li key={url} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">
                              {shortRelay(url)}
                              {writeSet.has(url) && (
                                <span className="ml-1.5 rounded bg-gray-200 px-1 text-[10px] font-semibold uppercase dark:bg-gray-700">
                                  {scan.relayList === "missing"
                                    ? "default write"
                                    : "write"}
                                </span>
                              )}
                            </span>
                            <span
                              className={
                                outcomes[url] === "answered"
                                  ? "flex-shrink-0 text-emerald-700 dark:text-emerald-400"
                                  : "flex-shrink-0"
                              }
                            >
                              {outcomes[url] === "answered"
                                ? "Answered"
                                : outcomes[url] === "timed-out"
                                  ? "Timed out"
                                  : "Failed"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {lazarusScanReachedNoRelay(scan) ? (
                  <ScanNotice>
                    No relay finished answering, so these versions may be
                    incomplete. Scan again to retry.
                  </ScanNotice>
                ) : (
                  !scan.currentConfirmed && (
                    <ScanNotice>
                      {scan.relayList === "unknown"
                        ? "Couldn't fetch your relay list, so the newest version found may not be current and nothing is recommended. Scan again to retry."
                        : "None of your write relays answered, so the newest version found may not be current and nothing is recommended. Retry them, or scan again."}
                    </ScanNotice>
                  )
                )}
                {scan.relayList === "missing" && (
                  <ScanNotice>
                    No relay list was found for your account, so Mutable&apos;s
                    default relays stand in as your write relays.
                  </ScanNotice>
                )}

                {scan.candidates.length === 0 ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    No versions found. The relays that answered hold no history
                    of this list.
                  </p>
                ) : (
                  <>
                    {scan.requiresIntentConfirmation && (
                      <ScanNotice>
                        An empty list can be intentional here, so nothing is
                        recommended. Choose the version you actually want.
                      </ScanNotice>
                    )}
                    {decryptingIds.size > 0 && (
                      <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <Loader2 size={12} className="animate-spin" />
                        Decrypting private items…
                      </p>
                    )}
                    {scan.recommended ? (
                      <div className="rounded-lg border border-emerald-300 bg-emerald-50/50 px-3 dark:border-emerald-800 dark:bg-emerald-900/10">
                        <div className="pt-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                          Your current version looks clobbered. This is the
                          fullest version from before the damage:
                        </div>
                        {renderCandidate(scan.recommended)}
                      </div>
                    ) : (
                      sortable &&
                      scan.currentConfirmed && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          No recoverable improvement found: your current version
                          doesn&apos;t look clobbered.
                        </p>
                      )
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
                      <span>
                        {scan.candidates.length}{" "}
                        {scan.candidates.length === 1 ? "version" : "versions"}{" "}
                        found
                      </span>
                      <div className="flex items-center gap-3">
                        {sortable && scan.candidates.length > 1 && (
                          <label className="flex items-center gap-1.5">
                            Sort by
                            <select
                              value={sortBy}
                              onChange={(e) =>
                                setSortBy(e.target.value as LazarusSortOrder)
                              }
                              className="rounded border border-gray-300 bg-transparent px-1.5 py-0.5 dark:border-gray-600"
                            >
                              <option value="date">Date</option>
                              <option value="size">Size</option>
                            </select>
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            downloadVersions(
                              `${profile.name} all versions`,
                              scan.candidates.map((c) => c.event),
                            )
                          }
                          className="flex items-center gap-1 underline hover:text-gray-900 dark:hover:text-white"
                        >
                          <Download size={12} />
                          Download all versions
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                      {bySize
                        ? bySize.map(renderCandidate)
                        : listItems.map((item) =>
                            item.type === "version" ? (
                              renderCandidate(item.candidate)
                            ) : (
                              <LazarusVersionGroup
                                key={`group-${item.candidates[0].event.id}`}
                                kind={profile.kind}
                                candidates={item.candidates}
                                clobbered={item.clobbered}
                                expanded={expandedGroups.has(
                                  item.candidates[0].event.id,
                                )}
                                onToggle={() =>
                                  setExpandedGroups((prev) => {
                                    const next = new Set(prev);
                                    const key = item.candidates[0].event.id;
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                  })
                                }
                              >
                                {item.candidates.map(renderCandidate)}
                              </LazarusVersionGroup>
                            ),
                          )}
                    </div>

                    {pastEmptyCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowEmpty((shown) => !shown)}
                        className="text-xs text-gray-600 underline hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                      >
                        {showEmpty
                          ? "Hide empty versions"
                          : `Show ${pastEmptyCount} empty ${pastEmptyCount === 1 ? "version" : "versions"}`}
                      </button>
                    )}
                    {Object.keys(scan.olderCursors ?? {}).length > 0 && (
                      <button
                        type="button"
                        onClick={loadOlder}
                        disabled={kindState.loadingOlder}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        {kindState.loadingOlder && (
                          <Loader2 size={14} className="animate-spin" />
                        )}
                        Load older versions
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {archiveForKind.length > 0 && (
              <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                  <HardDrive size={14} />
                  Saved on this device ({archiveForKind.length})
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Snapshots taken before each restore, and versions you
                  imported. Reviewing one compares it with your current version
                  on relays.
                </p>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                  {archiveForKind.map((entry) => {
                    const candidate: LazarusCandidate = {
                      event: entry.event,
                      foundOn: [],
                      itemCount: itemCountFor(profile, entry.event),
                      isCurrent: false,
                      isRecommended: false,
                    };
                    const onRelays = scan?.candidates.some(
                      (c) => c.event.id === entry.event.id,
                    );
                    const origin =
                      entry.source === "snapshot"
                        ? `saved before a restore, ${formatDate(entry.savedAt / 1000)}`
                        : `imported from ${entry.label}`;
                    return (
                      <LazarusVersionRow
                        key={`saved-${entry.event.id}`}
                        profile={profile}
                        candidate={candidate}
                        note={privateNotes[entry.event.id]}
                        decrypting={
                          decryptingIds.has(entry.event.id) &&
                          !privateTags.has(entry.event.id)
                        }
                        tooLargeToRestore={isTooLargeToRestore(entry.event)}
                        restorable={
                          canRestore && !isPastEmptyVersion(candidate, profile)
                        }
                        preparing={preparingId === entry.event.id}
                        onReview={(c) =>
                          openReview(
                            selectedKind,
                            c,
                            `Saved on this device: ${origin}`,
                          )
                        }
                        onDownload={(c) =>
                          downloadVersions(
                            `${profile.name} ${formatDate(c.event.created_at)}`,
                            [c.event],
                          )
                        }
                        onRetryDecrypt={retryDecrypt}
                        sourceLabel={
                          onRelays ? `${origin} · also on relays` : origin
                        }
                        onDelete={() => deleteSaved(entry)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {review && (
        <LazarusReviewDialog
          key={review.key}
          review={review}
          onClose={closeReview}
          onConfirm={confirmRestore}
        />
      )}
    </div>
  );
}

function ScanNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}
