// A database URL never contains whitespace, but pasted secrets can pick up
// invisible characters (line breaks, non-breaking or zero-width spaces).
const INVISIBLE = /[\s ​-‍⁠﻿]/g;

export function databaseUrl(): string {
  const url = (process.env.DATABASE_URL ?? "").replace(INVISIBLE, "");
  // Supabase's pooler: port 5432 is "session" mode (15 clients at once), 6543 is
  // "transaction" mode (hundreds). The nightly jobs run ~10 machines in parallel
  // and the website runs many short-lived functions, so use transaction mode.
  return url.replace(/(\.pooler\.supabase\.com):5432\//, "$1:6543/");
}

/** Describe stray characters without revealing the value. */
export function describeStrayChars(raw: string): string {
  const found = [...raw.matchAll(INVISIBLE)].map(
    (m) => `position ${m.index} of ${raw.length}: U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
  );
  return found.length ? found.join("; ") : "none";
}
