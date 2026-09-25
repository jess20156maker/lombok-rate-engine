// Create or update the database tables.
//
//   npm run db:migrate

import { readFileSync } from "node:fs";
import { db } from "../lib/db.js";

await db.query(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
const { rows } = await db.query(
  "select table_name from information_schema.tables where table_schema = 'public' order by 1",
);
console.log("Tables:", rows.map((r) => r.table_name).join(", "));
await db.end();
