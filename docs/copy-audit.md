# Copy Audit — User-Facing Text Density

**Scope:** every user-facing surface in `app/` and `components/` (~36k lines, 70+ files): headings, intros, info/warning callouts, empty states, toggles, buttons, `confirm()`/`alert()` dialogs, tooltips, placeholders, and route metadata.
**Question:** where do we overuse copy, and what should be condensed, deduplicated, or moved behind an expander?
**Status:** audit only — no UI changes made yet. Line numbers are as of v1.8.3 (`e224f00`).

---

## TL;DR

Yes — the app is consistently over-explained. The problem isn't one bad screen; it's five repeating habits:

1. **Always-open "how it works" callouts above the tool.** Nearly every tool opens with tagline → subtitle → coloured info box (and sometimes a second warning box) before the first input. Worst: Muggable (~175 words of stacked callouts), PrivacyControls (~150 words, open by default on every My Mutes visit), Onboarding step 2 (~150 words, 6 nested boxes), Settings "About" (~190-word feature list).
2. **Protocol jargon shown to everyone.** NIP numbers and event kinds (`NIP-07/44/46/51/56/65`, `kind:10000`, `kind:5`, `kind:1984`, `secp256k1`, `BIP341`) appear in first-read positions in ~20 places: auth modal, dashboard menu, onboarding, settings, header pills on Reportable/Redactable, Note Nuke intro, Snoopable subhead, recovery intros, import dialog, field labels.
3. **The same idea said 2–5 times on one screen.** Title + subtitle + info box restating each other; "backup is saved first" 5× on Decimator; the automated-report count 3× in one Reportable card; "Found 0 …" + "No … Found" + "No one has …" in empty states.
4. **Duplicated copy across twin components** that has already started to drift: Mute vs Follow recovery (~90% identical), three tool Wrappers, two share modals, bulk-unfollow `confirm()` template, "public vs private mutes" explained 4 different ways.
5. **Wordy dialogs and toggles.** Multi-bullet `confirm()`/`alert()` recaps, toggles like "*{n} automated reports (bots and swarms) hidden — excluded from score — click to show*", a 35-word feed status line in Redactable, and a three-step reset confirmation.

**Fixing the top 15 items below removes roughly 1,800–2,000 words of always-visible text** without dropping any information (it moves behind expanders/tooltips).

---

## Recommended building blocks (do these first)

There's no shared collapsible today; each file rolls its own. Good in-repo precedents to standardise on:

| Pattern | Precedent | Use for |
|---|---|---|
| Native `<details>/<summary>` | `Muggable.tsx:839` ("Advanced options"), `ReportDetailModal.tsx:637` ("Raw event JSON") | Default "How it works" / "Technical details" |
| Chevron toggle panel | `Muggable.tsx:253` (`SweepGuide`), `Mute-o-Scope.tsx:1049` ("Scan details"), `Decimator.tsx:536` | Richer expanders |
| Info-icon → modal | `MuteScoreModal`, `ReportScoreModal` | Score/metric explanations |

Proposed shared components:

- **`<HowItWorks summary="…">`** — styled `<details>`, collapsed by default. One-line lead stays visible; everything else goes inside. Replaces ~15 always-open info boxes.
- **`<ToolHeader icon title blurb pills>`** — enforce *one* blurb line (≤ ~15 words). Also kills the copy-pasted header/landing blocks in `ReciprocalsWrapper` / `DecimatorWrapper` / `PurgatoryWrapper` / Mute-o-Scope.
- **`<HiddenToggle count noun onToggle>`** — "`{n} {noun} hidden · Show`" / "`Hide {noun}`". Replaces the 4 long toggles in Reportable/Redactable.
- **`<RecoverySection copy={…}>`** — merge `MuteRecoverySection` + `FollowRecoverySection`.
- **`<ShareNoteModal>`** — merge `ShareResultsModal` / `DecimatorShareModal` / `ReportableShareModal` shells; render preview from the same `getActualShareMessage()` used for posting.
- **`confirmBulk()` / toast helper** — one short template for backup-then-publish confirms, and replace `alert()` success/failure pop-ups with inline toasts.
- **Single source for "Public vs private mutes"** — one short explainer used by Onboarding, PrivacyControls, Settings.

**Copy rules of thumb to adopt:** one visible sentence of intro per tool; no NIP/kind numbers outside `<details>`, tooltips, or the diagnostics page; a heading and its subtitle must not say the same thing; `confirm()` ≤ ~15 words; empty state = one sentence.

---

## Top 15 highest-impact changes

| # | Surface | Location | Problem | Fix | Sev |
|---|---|---|---|---|---|
| 1 | **My Mutes — privacy box** | `PrivacyControls.tsx:9, 166-199` | ~150 words (NIP-44/51/04, per-client matrix) and `useState(true)` → open on every visit, dismissal not persisted | Default collapsed (or persist dismissal). Visible: "Private mutes are encrypted but not every app supports them." Rest in `<HowItWorks>`; drop "💡 Your call" | High |
| 2 | **Onboarding step 2 & 3** | `OnboardingModal.tsx:50-163` | Step 2: 6 nested callouts, Kind 10000/30001, NIP-44/51 (~150w). Step 3: three stacked backup boxes. Also "Skip for Now" (`:183`) + "I'll Set Up Later" (`:262`) do the same thing | Step 2 → 3 plain sentences, tech in `<details>`. Step 3 → one red line + "Create my first backup" / "Skip" | High |
| 3 | **Muggable callouts** | `Muggable.tsx:903-958`, `:900` | ~175 words of on-chain-zap warnings always visible, plus `SweepGuide` shown even with no funds ("always visible" comment) | One line: "⚠ Avoid on-chain zaps to your Nostr key; use Lightning." Rest in expander. Render `SweepGuide` only when funded | High |
| 4 | **Settings — About** | `Settings.tsx:1123-1218` | ~30w description + 11-item, ~190w feature list with NIP refs; several entries are **inaccurate** (Mute-o-Scope, Muteuals, Backups) | One line + `<details>What's in Mutable</details>`; fix descriptions | High |
| 5 | **Settings — relays & sync** | `Settings.tsx:541-756, 855-921` | Stacked blue boxes (NIP-65 explainer, multi-device sync + tip, "About your data" which contradicts the sync box), two relay lists | Subhead lines only. Show "Active relays (n)"; NIP-65 read/write + Republish All + Synced Services in `<details>Advanced</details>` | High |
| 6 | **Settings — Danger Zone** | `Settings.tsx:1040-1102, 1223-1269` | Reset needs **3 confirmations**; "relay data is safe" said twice (3× incl. `:915`) | Card: delete list + "Nostr relay data is not affected." One modal, one confirm | High |
| 7 | **Backups — recovery sections** | `MuteRecoverySection.tsx:268-311`, `FollowRecoverySection.tsx:242-280`, `Backups.tsx:1582` | Parent intro + two child intros (kind:10000 / kind:3) + two "Before you scan" opt-in walls (~125w) before a *read-only* scan | Parent line only; children get a heading. Drop the opt-in gate; one line under Scan + one shared `<HowItWorks>` | High |
| 8 | **Backups — About box & stats** | `Backups.tsx:951-1018, 1082-1098, 1597` | "About Backups" box sits at top but describes the section at the bottom; overlaps its intro; 4 stat cards repeat tab counts | Merge into Local History intro; drop stat cards | High |
| 9 | **Redactable — feed & lookup stacks** | `Redactable.tsx:2103-2153, 2233-2241` | 35-word status template; 3–4 explanatory lines (honored toggle, third-party warning, green ✓ confirmation, "Newest first") before first row | "`{v}` requests with posts still up · checking x/y…" + ⓘ for filtered counts. Headline + one muted line | High |
| 10 | **Reportable/Redactable headers** | `Reportable.tsx:1053-1082`, `Redactable.tsx:1795-1820` | Tagline repeats the tab labels; NIP/kind pill; ~30–40w blue Note box | Tagline first clause only. Visible: "Reports are unverified claims, not verdicts." / "A deletion request is a wish, not an eraser." Pill + caveats → `<HowItWorks>` (also becomes the one home for honored/third-party/automated explanations) | High |
| 11 | **Purgatory tabs** | `Purgatory.tsx:358-370, 406-417, 525` | Always-visible two-paragraph orange "How it works" box per tab; "Threshold:" restates the field label; "Using NIP-65 relay discovery…" on every scan | One-line lead per tab + `<details>`; drop progress jargon | High |
| 12 | **Domain Purge header** | `DomainPurge.tsx:285-319, 391` | Subhead + "How it works" box + helper text all say the same thing; "NIP-05" ×3 incl. field label | "Mute and unfollow everyone you follow from one domain (e.g. mostr.pub)." Label: "Domain"; examples → placeholder | High |
| 13 | **Import confirmation** | `ImportConfirmationDialog.tsx:89-163` | Two stacked callouts + footer; "across all clients" ×2; kind 10000 / NIP-51; **points to wrong tab** ("My Mute List" — backups live in Backups) | One callout: "Adds N items and publishes your mute list. Consider a backup first (Backups tab)." Per-type grid in `<details>` | High |
| 14 | **Decimator backup promise** | `Decimator.tsx:305-354, 511-530, 906-920`, `DecimatorWrapper.tsx:228` | "Your list is backed up first" 5× on one screen; ~75w Unfollow-Everyone confirm; subtitle only mentions "percentage" mode | Fold into subtitle; one-sentence warning and confirm | High |
| 15 | **Mute-o-Scope / Muteuals / Reciprocals headers & empty states** | `Mute-o-Scope.tsx:847-880`, `Muteuals.tsx:366-382, 560-606`, `Reciprocals.tsx:611-628` | Title-dash-subtitle both saying the same; blue box restating "Public lists only" badge; Muteuals 55w kind-10000 empty state + "Quick Actions" banner; Reciprocals NIP-65 box | Title = tool name, one subtitle line; notes → `<HowItWorks>` / existing "Scan details" toggle | High |

---

## Bugs & inaccuracies found during the sweep

These are cheap and should ship regardless of the broader rewrite:

- `Decimator.tsx:138` — JS string `"You don&apos;t follow anyone yet!"` renders a literal `&apos;`.
- `ListCleaner.tsx:320` — Data Accuracy Notice tells users to click "View Profile"; no such button exists (rows are clickable).
- `ImportConfirmationDialog.tsx:97` — says to back up from the "My Mute List" tab; backups are in **Backups**.
- `app/dashboard/page.tsx:314-316` — alert references "My Mute List tab"; nav label is **My Mutes**.
- `OnboardingModal.tsx:183` / `:262` — two skip buttons with identical behaviour on the last step.
- `Settings.tsx:1123-1218` — feature descriptions for Mute-o-Scope, Muteuals and Backups don't match what the tools do.
- `Settings.tsx:906-921` vs `:697-718` — "stored locally in your browser" contradicts the multi-device-sync box directly above.
- `Reciprocals.tsx:849-850` — "All Clear!" empty state shows before any check has run.
- `Settings.tsx:382` — import toast uses `\n` inside a `<span>` (doesn't render).
- `NoteNuke.tsx:449-453` — author-mismatch `alert()` is unreachable (button already disabled at `:714`).
- `Reciprocals.tsx:585-601`, `Decimator.tsx:485-499` — dead signed-out branches (Wrapper already gates).
- `Settings.tsx:955-999` vs `PrivacyControls.tsx:126-163` — two separate controls for the default mute privacy.

---

## Cross-surface duplication

| Idea | Where it's repeated | Consolidate to |
|---|---|---|
| Public vs private mutes | `OnboardingModal:60-78`, `PrivacyControls:182-194`, `Settings:971, 996` | One shared explainer; one privacy-default control |
| "Only public mute lists are visible" | `Mute-o-Scope:867, 1305`, `Muteuals:378, 573, 591` | `<HowItWorks>` line in both tools |
| "Back up first" | Onboarding, PrivacyControls, ImportConfirmation, Settings reset, Decimator ×5, Clonable | Put it in the confirm only |
| "Relay/Nostr data is safe" | `Settings:915, 1064, 1243` | Once, on the Danger Zone card |
| Bulk-unfollow confirm template | `Reciprocals:263`, `Decimator:347`, `Muteuals:317`, `DomainPurge:190` | `confirmBulk()` helper |
| "Remember to publish changes" alerts | `Reciprocals:322, 412`, `Muteuals:277, 302`, `Purgatory:288` | One toast |
| Mute vs Follow recovery | Intros, bullets, confirm, success card, rejected note, no-result, signed-out | `<RecoverySection>` |
| Tool Wrappers | Reciprocals / Decimator / Purgatory Wrappers (~260 lines each), Mute-o-Scope inline | `<ToolHeader>` / `ToolPageShell` |
| Tool tagline | route metadata ×3 + Wrapper landing + in-tool subtitle (Purgatory, Reciprocals, Decimator) | One const per tool |
| Share modals | `ShareResultsModal`, `DecimatorShareModal`, `ReportableShareModal` (preview built separately from posted text) | `<ShareNoteModal>` |
| Nsec safety notice | `Clonable:511, 611, 666, 686`, `Muggable:293, 303` | `<NsecNotice>` one-liner at each input |
| Honored/automated toggles | `Redactable:2120, 2269` (verbatim), `Reportable:1433, 1961` | `<HiddenToggle>` |
| Protected-user alert | `ListCleaner:196, 218`, `DomainPurge:182` | Disabled button + tooltip |
| "Invalid npub format. Please check…" | `Reportable:405`, `Redactable:1008` | "Invalid npub." |
| Terminology drift | "My Mutes" vs "My Mute List"; "Mute Packs" vs "Public Packs" vs "Community Mute Lists"; "Pubkeys" vs "Profiles"; "Tags" vs "hashtags"; 3 different search placeholders | Pick one term each: **My Mutes**, **Mute Packs**, **Profiles**, placeholder "Name, NIP-05, or npub…" |

---

## Per-surface findings (condensed)

Severity: **H** high, **M** medium, **L** low. Type: Condense / Collapse / Dedupe / Remove.

### App shell, auth, onboarding, settings

- **AuthModal** — `:161-167` subtitle repeats heading (Remove, L). `:214, 240, 253, 362` "Browser Extension (NIP-07)" / "Remote Signer (NIP-46)" → "Browser extension" / "Remote signer (Amber, Primal…)" (M). `:222` + `:410-437` "No extension detected" and separate "Need a Nostr extension?" box → merge (M). `:403-405` bunker helper repeats placeholder and button (L).
- **Dashboard** — `:323-326` discard confirm → "Discard unsaved changes?" (L). `:511-518` "NIP-07 Extension" / "NIP-46 Remote Signer" → plain labels (L). `:289-291` backup alert → "Backed up N mutes and M follows." (L).
- **Onboarding** — `:22-45` intro + 4-bullet box → one line (M). See Top 15 #2.
- **Settings** — See Top 15 #4–6. Also: `:664-679` no-relay-list box → one line (L); `:1001-1029` "Show Onboarding / Welcome Tutorial / View again / Show Again" → one row "Welcome tutorial — Replay" (L); `:232` republish toast → "Republished to Z relays." (L).
- **PrivacyControls** — See Top 15 #1. `:61-63, 109-111, 131-135` badge text repeated in helper (Dedupe, L).
- **Landing** — `app/page.tsx:220-226` "Look Up Any User - No Login Required" + subtext repeating the placeholder → "Look up anyone — no login" (L).
- **Pack page** — `app/pack/[...slug]/page.tsx:254-259` "To import this pack: Sign in…" → a "Sign in to import" button (L).
- Lean already: DashboardNav, Footer, UnsavedChangesBanner, ConfirmOnExitDialog, diagnostics, layout metadata.

### Mute list, packs, backups, cleanup

- **Backups** — See Top 15 #7–8. `:1393-1397` list-backup intro: move "verbatim / never decrypted" into tooltip (M). `:1285` / `:1314` profile-backup empty state repeats intro → "No profile backups yet." (L). `:1146` / `:1466` NIP-46/NIP-07 "too large" error, two different wordings → "This backup is too large for your remote signer. Sign in with a browser extension to open it." (M). `:1450`, `:582` chunk counts → hide unless incomplete (L). Five near-identical restore confirms `:432, 622, 739, 774, 818` → one template (L). `:712` delete-all → "Delete all N backups? This can't be undone." (L).
- **Recovery sections** — See Top 15 #7. Also rejected-relay note `:413` / `:382`, no-result text `:467` / `:436`, event-ID on each candidate row, signed-out copy → one-liners (L).
- **List Cleaner** — `:302-323` intro + ~55w Data Accuracy Notice → one-line hint shown next to results (H; also fix "View Profile"). `:408-410` progress text redundant with bar (L). `:195-229` confirm/alerts → shorter; protected-user as disabled button + tooltip (L).
- **Domain Purge** — See Top 15 #12. `:190-204` 4-step confirm (~60w) → one sentence (M). `:256-263` 4-bullet success `alert()` → inline banner (M). `:129` unfollow confirm → "Unfollow? (Your follow list is backed up first.)" (L).
- **Pack card / list / create** — `PublicListCard.tsx:572-631` "N total items" + stats row + "N new items available" box, while button already says "Add N…" → drop two (M). `CreatePublicList.tsx:1056-1062` ~28w publicity note → "Packs are public; anyone can see and import them." beside Publish (M). `:1003-1053` summary card repeats counts (L). `:1118-1126` duplicate-name dialog → one line (L). `PublicLists.tsx:670-737` two-line empty states → one line (L). `MuteListCategory.tsx:778, 904, 959` "Event reference (optional): nevent1… or note1…" always shown → behind "+ Link a note" (M).
- **Misc** — `PublishSuccessModal.tsx:72-80` three lines for one fact → "Published! N items live." (L). `BackupRestore.tsx:59-89` four `alert()`s → toasts (L).

### Analysis tools

- **Mute-o-Scope** — See Top 15 #15. `:1304-1306` zero-result double heading (L). `:906` 5-item placeholder (L). `:1573` "Scroll down or click to load more • N remaining" → "Load N more" (L).
- **MuteScoreModal** — `:93-97` ratio explainer and `:119-123` NIP-45 footer → one line each (M).
- **Muteuals** — See Top 15 #15. `:277, 301, 317, 349, 180` confirms/alerts: publish reminder in both confirm and success; 4-line unfollow recap → "Unfollowed N. Backup saved." (M).
- **Reciprocals** — See Top 15 #15. `:90` "Second pass: Checking user relay preferences…" → "Double-checking… x/y" (L). `:263-269` bulk confirm (shared template) (M). `:849` premature "All Clear!" (M).
- **Decimator** — See Top 15 #14. `:561-563` protected-users helper → header `title=` (L). `:138` `&apos;` bug.
- **Purgatory** — See Top 15 #11. `:576-579` "Results appear in real-time…" (Remove, L). `:319-322` subtitle verbatim with Wrapper and metadata (L).
- **DM widgets** — `DMHeatmap.tsx:398-402` 27w footer → "Contents stay encrypted; this is public metadata." (L). `DMCircle.tsx:415-418` share text duplicated (L). DMLeaderboard is fine.
- **Share modals** — `ShareResultsModal.tsx:188-211` yellow "This is me!" box → plain checkbox (L). Shell and "Tip: Sign in to post…" duplicated across modals (M).
- **Route metadata** — description repeated ×3 per file → const; Mute-o-Scope title repeats description (L).

### Reportable / Redactable

- **Reportable header** — See Top 15 #10.
- **Lookup** — `:1283-1316` "Found 0 Public Reports" + "No Public Reports Found" + sentence → one heading (M). `:1421-1446` long automated toggle → `<HiddenToggle>` (M). `:703-726` automated count shown 3× (headline, chip, toggle) → headline only (M). `:1563, 1807, 2094` repeated "Evidence" label per row (L). `:1918` load-more (L). `:1135` 7-item placeholder (L).
- **Feed** — `:1961-1970` toggle → `<HiddenToggle>` (L).
- **ReportScoreModal** — `:321-323` drop "(NIP-56)" (L). `:356-362` keep the full caution *here* as the learn-more home; shrink the page Note instead; add the automated-exclusion explanation (M).
- **ReportDetailModal** — `:481-483` "NIP-56 report · kind:1984" subtitle → tooltip (L). `:620-623` restates heading (L). `:302-303` 20w missing-note text → "Note not found on relays (possibly deleted)." (L).
- **ReportableShareModal** — `:163-206` redundant subhead + "This is me!" helper (L). `:228-232` → "Include filed count ({n})" (L). `:243-297` preview duplicates generator (L). `:370-377` Tip box → inline muted text (L).
- **Redactable header** — See Top 15 #10. `:1929-1933` relay-panel helper (already collapsed; trim) (L).
- **Redactable lookup** — See Top 15 #9. `:2091-2095` 32w empty state → "No deletion requests found on the scanned relays." (M). `:2164-2172` empty state + "Use the toggle above" → one line + inline "Show honored" link (M). `:2204-2210` end-of-list repeats toggle → "End of list." (L).
- **Redactable feed** — `:2308-2317` 35w empty state → "Nothing to show — all spam, cleanup, or already honored." + link (M). `:1154-1156` error (L). `:2359-2361` → "End of feed." (L).
- **Metadata** — per-profile descriptions include "NIP-56 (kind:1984)" / "NIP-09 (kind:5)" on social cards → plain words (L).

### Utility tools & profile

- **Muggable** — See Top 15 #3. `:727-731` 36w secp256k1 intro → "Your Nostr key is also a Bitcoin key. See if it holds funds." (M). `:277-283` guide intro repeats Step 1 (L). `:303-307` vs `:293` duplicate nsec warnings (L). `:382-388` 65w "Realistically…" repeats Lightning advice (M). `:514` "Canonical Taproot address (BIP341 key-path)" → "Primary address (Taproot)" (L).
- **Clonable** — nsec-safety message up to 4× in one flow (`:511, 611, 666, 686`) → one short notice per input (H). `:606-634` 26w/22w mode cards → "Full clone, including private mutes." / "Public data only; no private mutes." (M). `:686-688` npub box repeats the card (M). `:801-806` overwrite warning — keep, trim to "Overwrites the selected data on your current account. Back up first." (L). `:498` / `:573` intro hard-coded twice (L).
- **Snoopable** — `:357-367` NIP-04/17/65 subhead + disclaimer → "Encrypted DMs still reveal who you talk to, and when." + `<details>` (M). `:373` label duplicates placeholder (L). `:323-329` `alert()`s → toasts (L). Metadata leads with "NIP-04" (L).
- **Note Nuke** — `:487-501` 38w intro with kind 5 / NIP-65 / NIP-07 + chips restating sources → "Send a delete request for any of your notes to every relay we can reach." + "Which relays?" `<details>` holding the chips (H). `:199-215` source labels → "Your relay list" / "Extension relays" (L). `:734`, `:391` "NIP-07 signer required" → "Requires a signer extension (e.g. Alby, nos2x)." (L). `:426` + success modal `:74-81` + stats row say the same thing 3× (L). `NoteNukeWrapper.tsx:194` "Get the full experience!" inconsistent with other wrappers (L). Keep the short best-effort warning at `:741`.
- **UserProfileModal** — `:850-946` three lookup cards with heading + restating subline (~45w) → one row of three buttons: "Muting me?" / "Who mutes them" / "Who reports them" (M). `:289-351` success `alert()`s → toasts (L). `:1287` "Merge Their Mute List with Mine" → "Merge into my list" (L).
- **ProfileEditorModal / search inputs** — lean. `ProfileEditorModal.tsx:508` "NIP-05 Identifier" → "Verified address (NIP-05)" (L).

---

## Suggested rollout

1. **Quick wins (one PR, low risk):** the bugs list above; PrivacyControls default-collapsed; drop NIP/kind numbers from auth modal, dashboard menu, field labels, pills; unify terminology.
2. **Shared primitives:** `<HowItWorks>`, `<HiddenToggle>`, `<ToolHeader>`, toast + `confirmBulk()`.
3. **Heavy screens:** Onboarding, Settings, Backups + recovery merge, Muggable, Reportable/Redactable, Purgatory, Domain Purge, List Cleaner.
4. **Long tail:** empty states, confirms, share-modal merge, metadata consts.
