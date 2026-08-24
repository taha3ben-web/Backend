#!/usr/bin/env node
"use strict";

/**
 * Verifies a Prisma baseline SQL file, or verifies that a drift diff is empty.
 *
 *   node verify-baseline-sql.js <file> baseline
 *   node verify-baseline-sql.js <file> drift
 *
 * baseline mode
 *   The file must create schema objects and nothing else. Any data statement
 *   (INSERT/UPDATE/DELETE/TRUNCATE), any destructive statement (DROP,
 *   ALTER COLUMN), any function or partition definition is rejected, because a
 *   baseline is only allowed to describe an empty database being built from
 *   scratch. Statement counts are reported but deliberately not used as a hard
 *   gate: the authoritative proof of correctness is the drift check performed
 *   against a database actually built from this file.
 *
 * drift mode
 *   The file must contain no executable statement at all. Anything else means
 *   the baseline does not reproduce prisma/schema.prisma.
 *
 * Read-only. Never connects to a database.
 */

const fs = require("fs");

const file = process.argv[2];
const mode = process.argv[3] || "baseline";

if (!file || !fs.existsSync(file)) {
  console.error(`missing file: ${file}`);
  process.exit(1);
}

const sql = fs.readFileSync(file, "utf8");

const codeLines = sql
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("--"));

function emit(text) {
  process.stdout.write(text + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  }
}

if (mode === "drift") {
  if (codeLines.length === 0) {
    emit("### Drift check");
    emit("");
    emit("**No drift.** The database built from `prisma/migrations/0_init` matches `prisma/schema.prisma` exactly.");
    process.exit(0);
  }
  emit("### Drift check");
  emit("");
  emit(`**DRIFT DETECTED** - ${codeLines.length} statement lines would still be required.`);
  emit("");
  emit("```sql");
  emit(codeLines.slice(0, 120).join("\n"));
  emit("```");
  process.exit(1);
}

const count = (re) => (sql.match(re) || []).length;

const counts = {
  "CREATE TABLE": count(/^\s*CREATE TABLE/gim),
  "CREATE TYPE": count(/^\s*CREATE TYPE/gim),
  "CREATE UNIQUE INDEX": count(/^\s*CREATE UNIQUE INDEX/gim),
  "CREATE INDEX": count(/^\s*CREATE INDEX/gim),
  "ALTER TABLE": count(/^\s*ALTER TABLE/gim),
  "FOREIGN KEY": count(/FOREIGN KEY/gi),
};

const forbidden = {
  DROP: count(/^\s*DROP\s/gim),
  DELETE: count(/^\s*DELETE\s/gim),
  UPDATE: count(/^\s*UPDATE\s/gim),
  INSERT: count(/^\s*INSERT\s/gim),
  TRUNCATE: count(/^\s*TRUNCATE\s/gim),
  "ALTER COLUMN": count(/ALTER COLUMN/gi),
  "CREATE FUNCTION": count(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/gi),
  PARTITION: count(/PARTITION/gi),
};

const out = [];
out.push("### Baseline SQL verification");
out.push("");
out.push(`\`${file}\` - ${sql.length} bytes, ${codeLines.length} statement lines`);
out.push("");
out.push("| statement | count |");
out.push("| --- | --- |");
for (const [key, value] of Object.entries(counts)) {
  out.push(`| ${key} | ${value} |`);
}
out.push("");
out.push("| forbidden pattern | occurrences |");
out.push("| --- | --- |");
for (const [key, value] of Object.entries(forbidden)) {
  out.push(`| ${key} | ${value} |`);
}
emit(out.join("\n"));

const problems = [];
if (codeLines.length === 0) {
  problems.push("the file contains no statement at all (this is the 0-byte failure mode)");
}
if (counts["CREATE TABLE"] === 0) {
  problems.push("no CREATE TABLE statement");
}
if (!/Driver_wilayaId/.test(sql)) {
  problems.push("the Driver_wilayaId index is missing, so the schema that was read is stale");
}
for (const [key, value] of Object.entries(forbidden)) {
  if (value > 0) {
    problems.push(`forbidden pattern present: ${key} (${value})`);
  }
}

if (problems.length > 0) {
  emit("");
  emit("**REJECTED**");
  emit(problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}

emit("");
emit("Accepted: schema-creating statements only, no data statement and no destructive statement.");
