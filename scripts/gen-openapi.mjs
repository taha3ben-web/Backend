#!/usr/bin/env node
// مولّد جرد OpenAPI من المصدر — بلا تبعيات خارجية.
//
// يمسح ملفّات *.controller.ts ويستخرج المسارات (البادئة + طريقة HTTP +
// الصلاحيات) ويولّد:
//   docs/api/openapi.json   — OpenAPI 3.1 على مستوى المسارات (paths/methods/tags/security)
//   docs/api/endpoints.md   — جدول مقروء مجمّع حسب الوحدة
//
// النطاق: دقيق على مستوى (المسار + الطريقة + الحراسة/الصلاحيات). لا يستنتج
// مخطّطات الطلب/الاستجابة (تُثرى يدويّا أو لاحقًا عبر @nestjs/swagger).
//
// التشغيل:  npm run docs:api

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "docs", "api");

const HTTP_METHODS = ["Get", "Post", "Put", "Patch", "Delete"];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && full.endsWith(".controller.ts")) out.push(full);
  }
  return out;
}

function joinPath(...parts) {
  const joined = parts
    .map((p) => String(p ?? "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return "/" + joined;
}

function extractPermissions(block) {
  const perms = [];
  const re = /@RequirePermissions\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(block))) {
    for (const q of m[1].matchAll(/"([^"]+)"/g)) perms.push(q[1]);
  }
  return perms;
}

function moduleOf(relPath) {
  const mod = relPath.match(/modules[\/]([^\/]+)[\/]/);
  return mod ? mod[1] : relPath.split(path.sep)[0];
}

const routes = [];
const tagsSet = new Set();

for (const file of walk(SRC)) {
  const content = fs.readFileSync(file, "utf8");
  const rel = path.relative(SRC, file);
  const moduleName = moduleOf(rel);

  const ctrlMatch = content.match(/@Controller\(\s*(?:"([^"]*)")?\s*\)/);
  if (!ctrlMatch) continue;
  const basePath = ctrlMatch[1] ?? "";

  const [header, body = ""] = content.split(/export\s+class\s+/);
  const classSecured = /@UseGuards\([^)]*JwtAuthGuard/.test(header);
  const classPerms = extractPermissions(header);

  const blockRe =
    /((?:[ \t]*@\w+\([^\n]*\)[ \t]*\n)+)[ \t]*(?:async[ \t]+)?(\w+)\s*\(/g;
  let bm;
  while ((bm = blockRe.exec(body))) {
    const block = bm[1];
    const methodName = bm[2];
    let route = null;
    for (const verb of HTTP_METHODS) {
      const rm = block.match(
        new RegExp(`@${verb}\\(\\s*(?:"([^"]*)")?\\s*\\)`),
      );
      if (rm) {
        route = { verb: verb.toLowerCase(), sub: rm[1] ?? "" };
        break;
      }
    }
    if (!route) continue;

    const methodSecured = classSecured || /@UseGuards\([^)]*JwtAuthGuard/.test(block);
    const perms = Array.from(new Set([...classPerms, ...extractPermissions(block)]));
    const fullPath = joinPath("api", basePath, route.sub);
    tagsSet.add(moduleName);
    routes.push({
      module: moduleName,
      method: route.verb,
      path: fullPath,
      operationId: `${moduleName}_${methodName}`,
      secured: methodSecured,
      permissions: perms,
    });
  }
}

routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// ---- OpenAPI 3.1 (paths-level) ----
const paths = {};
for (const r of routes) {
  paths[r.path] = paths[r.path] ?? {};
  const op = {
    tags: [r.module],
    operationId: r.operationId,
    summary: `${r.method.toUpperCase()} ${r.path}`,
    responses: { "200": { description: "OK" } },
  };
  if (r.secured) op.security = [{ bearerAuth: [] }];
  if (r.permissions.length)
    op.description = `الصلاحيات المطلوبة: ${r.permissions.join(", ")}`;
  paths[r.path][r.method] = op;
}

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "NOVA Ride API",
    version: "1.0.0",
    description:
      "جرد مسارات مُولّد آليًا من المتحكّمات. البادئة /api؛ كل المسارات متاحة أيضًا تحت /api/v1. " +
      "لا يتضمّن هذا الجرد مخطّطات الطلب/الاستجابة (تُثرى لاحقًا).",
  },
  servers: [{ url: "{baseUrl}", variables: { baseUrl: { default: "http://localhost:4000" } } }],
  tags: Array.from(tagsSet).sort().map((t) => ({ name: t })),
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  paths,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "openapi.json"), JSON.stringify(openapi, null, 2) + "\n");

// ---- endpoints.md ----
const byModule = new Map();
for (const r of routes) {
  if (!byModule.has(r.module)) byModule.set(r.module, []);
  byModule.get(r.module).push(r);
}
let md = "# جرد نقاط النهاية (Endpoints)\n\n";
md += "> مُولّد آليًا عبر `npm run docs:api` من `*.controller.ts`. لا تُحرّره يدويًا.\n\n";
md += `إجمالي المسارات: **${routes.length}** عبر **${byModule.size}** وحدة.\n\n`;
md += "كل المسارات متاحة تحت البادئة `/api` وأيضًا `/api/v1`.\n\n";
for (const mod of Array.from(byModule.keys()).sort()) {
  md += `## ${mod}\n\n`;
  md += "| الطريقة | المسار | الحماية | الصلاحيات |\n|---|---|---|---|\n";
  for (const r of byModule.get(mod)) {
    md += `| ${r.method.toUpperCase()} | \`${r.path}\` | ${r.secured ? "Bearer" : "عام/آخر"} | ${r.permissions.join(", ") || "—"} |\n`;
  }
  md += "\n";
}
fs.writeFileSync(path.join(OUT_DIR, "endpoints.md"), md);

console.log(`\u2705 \u062a\u0648\u0644\u064a\u062f ${routes.length} \u0645\u0633\u0627\u0631 \u0639\u0628\u0631 ${byModule.size} \u0648\u062d\u062f\u0629 \u2192 docs/api/openapi.json + endpoints.md`);
