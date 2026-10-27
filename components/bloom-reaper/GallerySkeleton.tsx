/**
 * Placeholder gallery shown while servers are still listing: same tile
 * proportions as BlobTile (h-32 media, hash/size line, server chips,
 * upload line, action row) so the page holds its shape until results land.
 */
export default function GallerySkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-line overflow-hidden bg-black/10 dark:bg-white/5 animate-pulse"
        >
          <div className="h-32 bg-black/10 dark:bg-white/10" />
          <div className="p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-3 w-16 rounded bg-black/10 dark:bg-white/10" />
              <div className="h-3 w-10 rounded bg-black/10 dark:bg-white/10" />
            </div>
            <div className="flex flex-wrap gap-1">
              <div className="h-4 w-16 rounded border border-line-2" />
              <div className="h-4 w-14 rounded border border-line-2" />
            </div>
            <div className="h-3 w-24 rounded bg-black/10 dark:bg-white/10" />
            <div className="flex items-center gap-1.5 pt-0.5">
              <div className="h-7 flex-1 rounded-lg bg-black/10 dark:bg-white/10" />
              <div className="w-8 h-8 rounded-lg bg-black/10 dark:bg-white/10" />
              <div className="w-8 h-8 rounded-lg bg-black/10 dark:bg-white/10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
