/** Check if a string looks like a 64-char hex event ID. */
export function isEventId(str: string): boolean {
  return /^[0-9a-f]{64}$/i.test(str);
}

/** Extract reason from tag rest fields (skips relay URLs and event IDs). */
export function extractTagReason(rest: string[]): string | undefined {
  return rest.find(
    (item) => !item.startsWith("wss://") && !isEventId(item),
  );
}

/** Extract event reference (hex event ID) from tag rest fields. */
export function extractTagEventRef(rest: string[]): string | undefined {
  return rest.find((item) => isEventId(item));
}

/** Wrap an async operation with a timeout. */
export function queryWithTimeout<T>(
  queryFn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = "Query timeout",
): Promise<T> {
  return Promise.race([
    queryFn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
    ),
  ]);
}

/** Process items in batches with optional progress reporting and abort support. */
export async function processBatch<T, R>(
  items: T[],
  processFn: (item: T) => Promise<R | null>,
  config: {
    batchSize?: number;
    delayMs?: number;
    onProgress?: (current: number, total: number) => void;
    abortSignal?: AbortSignal;
  } = {},
): Promise<R[]> {
  const { batchSize = 5, delayMs = 100, onProgress, abortSignal } = config;
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    if (abortSignal?.aborted) break;

    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((item) => processFn(item)),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value !== null) {
        results.push(result.value);
      }
    }

    onProgress?.(Math.min(i + batchSize, items.length), items.length);

    if (i + batchSize < items.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
