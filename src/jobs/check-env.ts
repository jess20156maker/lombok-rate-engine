// Fail fast, with a readable reason, if DATABASE_URL is missing or malformed.
// Never prints the value.
//
//   npm run check-env

import "dotenv/config";
import pg from "pg";
import { databaseUrl, describeStrayChars } from "../lib/env.js";

const raw = process.env.DATABASE_URL ?? "";
const url = databaseUrl();
const fail = (why: string) => {
  console.error(`DATABASE_URL problem: ${why}`);
  process.exit(1);
};

const stray = describeStrayChars(raw);
if (stray !== "none") console.log(`Note: removed invisible characters from the secret (${stray}).`);

if (!url) fail("it is empty or not set. Add it under Settings > Secrets and variables > Actions.");
if (url.startsWith("DATABASE_URL=")) fail('it starts with "DATABASE_URL=". Paste only the part after the = sign.');
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
