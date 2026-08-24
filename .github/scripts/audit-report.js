#!/usr/bin/env node
"use strict";

/**
 * Turns `npm audit --json` output into a reviewable Markdown report.
 *
 * Reads (all optional, missing files are tolerated):
 *   /tmp/full-audit.json     npm audit --json
 *   /tmp/runtime-audit.json  npm audit --omit=dev --json
 *   /tmp/fix-dry-run.json    npm audit fix --omit=dev --dry-run --json
 *
 * Writes Markdown to stdout. Read-only: never mutates the repository.
 */

const fs = require("fs");
const path = require("path");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

const full = readJson("/tmp/full-audit.json");
const prod = readJson("/tmp/runtime-audit.json");
const fixDry = readJson("/tmp/fix-dry-run.json");

const lines = [];
const w = (s) => lines.push(s === undefined ? "" : String(s));

function counts(report) {
  const m = report && report.metadata && report.metadata.vulnerabilities;
  if (!m) return "unavailable";
  return `total ${m.total} · critical ${m.critical} · high ${m.high} · moderate ${m.moderate} · low ${m.low} · info ${m.info}`;
}

function installedVersion(node) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), node, "package.json"), "utf8"),
    );
    return pkg.version || "?";
  } catch (err) {
    return "not-installed";
  }
}

function viaNames(v) {
  return (v.via || [])
    .map((x) => (typeof x === "string" ? x : x && x.name))
    .filter(Boolean);
}

function advisories(v) {
  const out = [];
  for (const via of v.via || []) {
    if (!via || typeof via === "string") continue;
    out.push({
      severity: via.severity || "?",
      title: via.title || "",
      url: via.url || "",
      range: via.range || "",
      cwe: Array.isArray(via.cwe) ? via.cwe.join(" ") : "",
    });
  }
  return out;
}

function fixText(f) {
  if (f === true) return "yes, within the allowed range";
  if (!f) return "**NO FIX AVAILABLE**";
  if (typeof f === "object") {
    const target = `\`${f.name}@${f.version}\``;
    return f.isSemVerMajor
      ? `${target} — **SEMVER MAJOR (do not apply in this task)**`
      : `${target} — minor/patch`;
  }
  return String(f);
}

function rank(sev) {
  return sev === "critical" ? 0 : sev === "high" ? 1 : 2;
}

function highs(report) {
  if (!report || !report.vulnerabilities) return [];
  return Object.values(report.vulnerabilities)
    .filter((v) => v.severity === "high" || v.severity === "critical")
    .sort(
      (a, b) => rank(a.severity) - rank(b.severity) || a.name.localeCompare(b.name),
    );
}

const prodHigh = highs(prod);
const fullHigh = highs(full);
const prodNames = new Set(prodHigh.map((v) => v.name));
const devOnlyHigh = fullHigh.filter((v) => !prodNames.has(v.name));

w("## Dependency Audit Report");
w("");
w("Produced by `.github/workflows/dependency-audit-report.yml`. Read-only: no files changed, `npm audit fix --force` never used.");
w("");
w("| scope | counts |");
w("| --- | --- |");
w(`| production only (\`--omit=dev\`) | ${counts(prod)} |`);
w(`| everything including dev | ${counts(full)} |`);
w("");
w(`**HIGH/CRITICAL reachable in production: ${prodHigh.length}** — dev/build-only: ${devOnlyHigh.length}`);
w("");

w("### 1) Production HIGH / CRITICAL");
w("");
if (prodHigh.length === 0) {
  w("None. `npm audit --omit=dev --audit-level=high` is clean, so the blocking gate passes.");
} else {
  w("| severity | package | installed | vulnerable range | direct? | fixAvailable |");
  w("| --- | --- | --- | --- | --- | --- |");
  for (const v of prodHigh) {
    const versions =
      [...new Set((v.nodes || []).map(installedVersion))].join(", ") || "?";
    w(
      `| ${v.severity} | \`${v.name}\` | ${versions} | \`${v.range}\` | ${v.isDirect ? "direct" : "transitive"} | ${fixText(v.fixAvailable)} |`,
    );
  }
  w("");
  for (const v of prodHigh) {
    w(`#### \`${v.name}\` — ${v.severity}`);
    w(`- vulnerable range: \`${v.range}\``);
    w(`- direct dependency: ${v.isDirect}`);
    w(
      `- installed at: ${(v.nodes || []).map((n) => `\`${n}\` (${installedVersion(n)})`).join(", ") || "none"}`,
    );
    w(
      `- pulled in via: ${viaNames(v).map((n) => `\`${n}\``).join(", ") || "n/a"}`,
    );
    w(
      `- breaks (effects): ${(v.effects || []).map((n) => `\`${n}\``).join(", ") || "none"}`,
    );
    w(`- fixAvailable: ${fixText(v.fixAvailable)}`);
    const adv = advisories(v);
    if (adv.length) {
      w("- advisories:");
      for (const a of adv) {
        w(`  - ${a.severity} — ${a.title} — ${a.url} — affected \`${a.range}\` ${a.cwe}`);
      }
    }
    w("");
  }
}

w("### 2) Dev / build-only HIGH / CRITICAL");
w("");
w("These are never shipped to production, so they must not force a Major upgrade.");
w("");
if (devOnlyHigh.length === 0) {
  w("None.");
} else {
  w("| severity | package | vulnerable range | fixAvailable |");
  w("| --- | --- | --- | --- |");
  for (const v of devOnlyHigh) {
    w(`| ${v.severity} | \`${v.name}\` | \`${v.range}\` | ${fixText(v.fixAvailable)} |`);
  }
}
w("");

w("### 3) `npm audit fix --omit=dev --dry-run` (no `--force`)");
w("");
if (!fixDry) {
  w("Output unavailable.");
} else {
  const fmt = (arr) =>
    Array.isArray(arr) && arr.length
      ? arr
          .map((x) =>
            typeof x === "string"
              ? `\`${x}\``
              : `\`${(x && x.name) || "?"}@${(x && x.version) || "?"}\``,
          )
          .join(", ")
      : "none";
  w(`- added: ${fmt(fixDry.added)}`);
  w(`- removed: ${fmt(fixDry.removed)}`);
  w(`- changed: ${fmt(fixDry.changed)}`);
  if (fixDry.audit && fixDry.audit.metadata) {
    w(`- residual after the safe fix: ${counts(fixDry.audit)}`);
  }
}
w("");

w("### 4) Raw data");
w("");
w("`full-audit.json`, `runtime-audit.json` and `fix-dry-run.json` are attached to this run as the `dependency-audit-json` artifact.");

process.stdout.write(lines.join("\n") + "\n");
