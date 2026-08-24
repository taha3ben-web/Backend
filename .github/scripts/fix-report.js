#!/usr/bin/env node
"use strict";

/**
 * Builds the Markdown report for the security fix run.
 * Reads audit JSON before/after, the resolver output, the git diff, and the
 * exit codes of every verification command (passed through the environment).
 */

const fs = require("fs");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    return "";
  }
}

const before = readJson("/tmp/audit-before.json");
const after = readJson("/tmp/audit-after.json");
const resolved = readJson("/tmp/resolved.json") || [];
const diffStat = readText("/tmp/diff.txt").trim();

const rc = {
  audit: process.env.RC_AUDIT,
  build: process.env.RC_BUILD,
  test: process.env.RC_TEST,
  lint: process.env.RC_LINT,
  tsc: process.env.RC_TSC,
};

const mark = (v) => (v === "0" ? "PASS" : `FAIL (exit ${v})`);

function counts(report) {
  const m = report && report.metadata && report.metadata.vulnerabilities;
  if (!m) return null;
  return m;
}

function highList(report) {
  if (!report || !report.vulnerabilities) return [];
  return Object.values(report.vulnerabilities)
    .filter((v) => v.severity === "high" || v.severity === "critical")
    .map((v) => v.name)
    .sort();
}

function installedVersions(report, name) {
  const v = report && report.vulnerabilities && report.vulnerabilities[name];
  if (!v) return "";
  return (v.nodes || []).join(", ");
}

const out = [];
const w = (s) => out.push(s === undefined ? "" : String(s));

const cb = counts(before);
const ca = counts(after);
const hb = highList(before);
const ha = highList(after);
const fixedNames = hb.filter((n) => !ha.includes(n));
const newNames = ha.filter((n) => !hb.includes(n));

w("## Security Fix Run");
w("");
w("Everything below was executed by GitHub Actions on a clean runner. `npm audit fix --force` was never used.");
w("");

w("### Production audit (`--omit=dev`)");
w("");
w("| | before | after |");
w("| --- | --- | --- |");
if (cb && ca) {
  w(`| critical | ${cb.critical} | ${ca.critical} |`);
  w(`| high | ${cb.high} | ${ca.high} |`);
  w(`| moderate | ${cb.moderate} | ${ca.moderate} |`);
  w(`| low | ${cb.low} | ${ca.low} |`);
  w(`| **total** | **${cb.total}** | **${ca.total}** |`);
} else {
  w("| n/a | audit JSON unavailable | |");
}
w("");
w(`HIGH/CRITICAL before: ${hb.length ? hb.map((n) => "`" + n + "`").join(", ") : "none"}`);
w("");
w(`HIGH/CRITICAL after: ${ha.length ? ha.map((n) => "`" + n + "`").join(", ") : "**none**"}`);
w("");
w(`Resolved by this run: ${fixedNames.length ? fixedNames.map((n) => "`" + n + "`").join(", ") : "none"}`);
w("");
if (newNames.length) {
  w(`:warning: Newly introduced: ${newNames.map((n) => "`" + n + "`").join(", ")}`);
  w("");
}

w("### Registry resolution (proof that each override version exists)");
w("");
w("| package | installed | minSafe | status | chosen | latest in major |");
w("| --- | --- | --- | --- | --- | --- |");
for (const r of resolved) {
  w(
    `| \`${r.package}\` | ${r.installed} | ${r.minSafe} | ${r.status} | ${r.resolved || "—"} | ${r.latestPublishedInMajor || "—"} |`,
  );
}
w("");

w("### Verification (all blocking, none bypassed)");
w("");
w("| command | result |");
w("| --- | --- |");
w(`| \`npm audit --omit=dev --audit-level=high\` | ${mark(rc.audit)} |`);
w(`| \`npm run build\` | ${mark(rc.build)} |`);
w(`| \`npm run test:ci\` | ${mark(rc.test)} |`);
w(`| \`npm run lint:check\` | ${mark(rc.lint)} |`);
w(`| \`npm run typecheck:strict\` | ${mark(rc.tsc)} |`);
w("");

w("### Remaining HIGH/CRITICAL in production, with the reason");
w("");
if (ha.length === 0) {
  w("None.");
} else {
  w("| package | installed at | vulnerable range | fixAvailable |");
  w("| --- | --- | --- | --- |");
  for (const name of ha) {
    const v = after.vulnerabilities[name];
    let fix = "none";
    if (v.fixAvailable === true) fix = "in-range";
    else if (v.fixAvailable && typeof v.fixAvailable === "object") {
      fix = `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? " (SEMVER MAJOR)" : ""}`;
    }
    w(`| \`${name}\` | ${installedVersions(after, name)} | \`${v.range}\` | ${fix} |`);
  }
}
w("");

w("### Changed files");
w("");
w("```");
w(diffStat || "(no tracked file changed)");
w("```");
w("");

for (const [label, file] of [
  ["npm audit", "/tmp/audit.log"],
  ["build", "/tmp/build.log"],
  ["tests", "/tmp/test.log"],
  ["lint", "/tmp/lint.log"],
  ["strict typecheck", "/tmp/tsc.log"],
]) {
  const text = readText(file).trim();
  if (!text) continue;
  const tail = text.split("\n").slice(-40).join("\n");
  w(`<details><summary>${label} — last 40 lines</summary>`);
  w("");
  w("```");
  w(tail);
  w("```");
  w("");
  w("</details>");
  w("");
}

fs.writeFileSync("/tmp/report.md", out.join("\n") + "\n");
process.stdout.write(out.join("\n") + "\n");
