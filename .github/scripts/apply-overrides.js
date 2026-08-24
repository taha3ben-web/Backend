#!/usr/bin/env node
"use strict";

/**
 * Writes npm `overrides` into package.json, using ONLY versions that
 * resolve-safe-versions.js proved to be published.
 *
 * Never touches dependencies/devDependencies ranges, scripts, or anything else.
 * Preserves the file's existing indentation so the diff stays minimal.
 */

const fs = require("fs");

const RESOLVED = "/tmp/resolved.json";
const PKG = "package.json";

if (!fs.existsSync(RESOLVED)) {
  console.error(`missing ${RESOLVED}; run resolve-safe-versions.js first`);
  process.exit(1);
}

const resolved = JSON.parse(fs.readFileSync(RESOLVED, "utf8"));
const raw = fs.readFileSync(PKG, "utf8");
const pkg = JSON.parse(raw);

// Detect the existing indentation (tab or n spaces) from the first nested key.
const indentMatch = raw.match(/\n([\t ]+)"/);
const indent = indentMatch ? indentMatch[1] : "  ";

const applied = [];
const skipped = [];

const overrides = { ...(pkg.overrides || {}) };

for (const item of resolved) {
  if (item.status !== "resolved" || !item.resolved) {
    skipped.push(`${item.package} (${item.status})`);
    continue;
  }
  overrides[item.package] = item.resolved;
  applied.push(`${item.package}@${item.resolved}`);
}

if (applied.length === 0) {
  console.log("no overrides to apply");
} else {
  pkg.overrides = overrides;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, indent) + "\n");
}

console.log(`applied: ${applied.length ? applied.join(", ") : "none"}`);
console.log(`skipped: ${skipped.length ? skipped.join(", ") : "none"}`);
