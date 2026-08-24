#!/usr/bin/env node
"use strict";

/**
 * Proves, against the real npm registry, which safe version actually exists
 * for every planned override. Writes /tmp/resolved.json.
 *
 * Rule enforced here: an override is emitted ONLY for a version that is
 * published, stable, inside the currently installed major, and >= minSafe.
 * If no such version exists the entry is marked "unavailable" and no override
 * is written for it.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");

const PLAN = ".github/security-fix-plan.json";
const OUT = "/tmp/resolved.json";

const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));

const isStable = (v) => /^\d+\.\d+\.\d+$/.test(v);

function cmp(a, b) {
  const A = a.split(".").map(Number);
  const B = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (A[i] !== B[i]) return A[i] - B[i];
  }
  return 0;
}

function publishedVersions(pkg) {
  const raw = execFileSync("npm", ["view", pkg, "versions", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

const results = [];

for (const item of plan.overrides) {
  const entry = {
    package: item.package,
    installed: item.installed,
    allowedMajor: item.allowedMajor,
    minSafe: item.minSafe,
    ghsa: item.ghsa,
    chain: item.chain,
    whyOverride: item.whyOverride,
  };

  let versions;
  try {
    versions = publishedVersions(item.package);
  } catch (err) {
    entry.status = "registry-error";
    entry.error = String((err && err.message) || err).slice(0, 400);
    results.push(entry);
    console.log(`[registry-error] ${item.package}: ${entry.error}`);
    continue;
  }

  const inMajor = versions
    .filter(isStable)
    .filter((v) => Number(v.split(".")[0]) === item.allowedMajor)
    .sort(cmp);

  const candidates = inMajor.filter((v) => cmp(v, item.minSafe) >= 0);

  entry.latestPublishedInMajor = inMajor.length ? inMajor[inMajor.length - 1] : null;
  entry.latestPublishedOverall = versions.filter(isStable).sort(cmp).pop() || null;

  if (candidates.length === 0) {
    entry.status = "unavailable";
    entry.resolved = null;
    console.log(
      `[unavailable] ${item.package}: no published stable ${item.allowedMajor}.x >= ${item.minSafe}. ` +
        `latest in major = ${entry.latestPublishedInMajor}, latest overall = ${entry.latestPublishedOverall}`,
    );
  } else {
    entry.status = "resolved";
    entry.resolved = candidates[0];
    console.log(
      `[resolved] ${item.package}: ${item.installed} -> ${entry.resolved} ` +
        `(lowest published stable ${item.allowedMajor}.x satisfying >= ${item.minSafe}; ` +
        `latest in major = ${entry.latestPublishedInMajor})`,
    );
  }

  results.push(entry);
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
console.log(`\nwrote ${OUT}`);
