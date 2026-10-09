"use client";

import { DoorClosed, LockKeyhole } from "lucide-react";

/**
 * The rule Draftable is named for: people in a follow pack can't remove
 * themselves. Each variant states it for the person looking — someone browsing,
 * someone who's been drafted, the author, or someone about to draft people.
 */

export function NoExitIntro() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
      <DoorClosed
        size={22}
        className="text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5"
      />
      <div className="text-sm text-amber-900 dark:text-amber-200 space-y-1.5">
        <p className="font-bold text-base">
          Nobody can leave a follow pack. Once you&apos;re drafted, you&apos;re
          in.
        </p>
        <p>
          A follow pack is a public list signed by the person who made it.
          Anyone can draft anyone into one: nobody is asked, nobody is
          notified, and there is no way to remove yourself. Only the pack&apos;s
          author can take someone out.
        </p>
      </div>
    </div>
  );
}

export function DraftedNotice({
  authorName,
  children,
}: {
  authorName: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-4 sm:p-5 rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
      <div className="flex items-start gap-3">
        <LockKeyhole
          size={22}
          className="text-red-700 dark:text-red-400 flex-shrink-0 mt-0.5"
        />
        <div className="flex-1 text-sm text-red-900 dark:text-red-200 space-y-1.5">
          <p className="font-bold text-base">
            You&apos;ve been drafted into this pack, and you can&apos;t leave.
          </p>
          <p>
            {authorName} put you here without asking. Nostr gives you no way to
            take yourself out: only {authorName} can publish a version of this
            pack without you. You can ask them to release you, or mute them.
            Muting hides them from you; it doesn&apos;t get you out.
          </p>
          {children && (
            <div className="flex flex-wrap gap-2 pt-2">{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuthorNotice({ count }: { count: number }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
      <DoorClosed
        size={20}
        className="text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5"
      />
      <p className="text-sm text-amber-900 dark:text-amber-200">
        <span className="font-semibold">You drafted everyone here.</span> None
        of {count === 1 ? "this person" : `these ${count} people`} agreed to
        be in this pack, and none of them can leave it. You&apos;re the only
        one who can release them, by editing or deleting the pack.
      </p>
    </div>
  );
}

export function BystanderNotice({ authorName }: { authorName: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <DoorClosed
        size={18}
        className="text-gray-500 dark:text-gray-400 flex-shrink-0 mt-0.5"
      />
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Everyone in this pack was drafted by {authorName}. They weren&apos;t
        asked, and they can&apos;t leave. Only {authorName} can take someone
        out.
      </p>
    </div>
  );
}

export function EditorNotice() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
      <DoorClosed
        size={22}
        className="text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5"
      />
      <div className="text-sm text-amber-900 dark:text-amber-200 space-y-1.5">
        <p className="font-bold text-base">You&apos;re drafting people.</p>
        <p>
          The people you add won&apos;t be asked and can&apos;t remove
          themselves. Only you can release them, by editing or deleting this
          pack. Deleting only asks relays to drop it, so copies may survive.
        </p>
      </div>
    </div>
  );
}
