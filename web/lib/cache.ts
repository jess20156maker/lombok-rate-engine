import "server-only";

// The collector writes once a night, so pages can share loaded data between
// requests. Concurrent callers share one in-flight load instead of each
// pulling the same rows from the database.
const store = ((globalThis as unknown as { __dataCache?: Map<string, { at: number; value: Promise<unknown> }> }).__dataCache ??=
  new Map());

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    store.delete(key); // don't cache failures
    throw err;
  });
  store.set(key, { at: Date.now(), value });
  return value;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
