// A database URL never contains whitespace, but pasted secrets can pick up
// invisible characters (line breaks, non-breaking or zero-width spaces).
const INVISIBLE = /[\s ​-‍⁠﻿]/g;

export function databaseUrl(): string {
  return (process.env.DATABASE_URL ?? "").replace(INVISIBLE, "");
}

/** Describe stray characters without revealing the value. */
export function describeStrayChars(raw: string): string {
  const found = [...raw.matchAll(INVISIBLE)].map(
    (m) => `position ${m.index} of ${raw.length}: U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
  );
  return found.length ? found.join("; ") : "none";
}
