// Fail fast, with a readable reason, if DATABASE_URL is missing or malformed.
// Never prints the value.
//
//   npm run check-env

import "dotenv/config";
import pg from "pg";

// Stray spaces or a line break at either end are common when pasting; ignore them.
const url = (process.env.DATABASE_URL ?? "").trim();
const fail = (why: string) => {
  console.error(`DATABASE_URL problem: ${why}`);
  process.exit(1);
};

if (!url) fail("it is empty or not set. Add it under Settings > Secrets and variables > Actions.");
if (url.startsWith("DATABASE_URL=")) fail('it starts with "DATABASE_URL=". Paste only the part after the = sign.');
if (/\s/.test(url)) fail("it contains a space or line break in the middle. Re-paste it as one line.");
if (!/^postgres(ql)?:\/\//.test(url)) fail('it should start with "postgresql://".');
if (url.includes("[YOUR-PASSWORD]")) fail("it still contains [YOUR-PASSWORD] instead of the real password.");
if (/@db\.[a-z]+\.supabase\.co/.test(url)) fail("it is the Direct connection address; use the Session pooler one.");

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
try {
  await db.connect();
  await db.query("select 1");
  await db.end();
  console.log(`DATABASE_URL OK (${url.length} characters, host ${new URL(url).hostname})`);
} catch (err) {
  fail(`could not connect: ${(err as Error).message.replace(url, "<url>")}`);
}
