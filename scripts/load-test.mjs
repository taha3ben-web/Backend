#!/usr/bin/env node
// اختبار حِمل خفيف مستقلّ لخادم NOVA — بلا أي تبعيات خارجية (http/https المدمج).
//
// يولّد حِملًا متزامنًا على مسارات قراءة ساخنة ويطبع زمن الاستجابة
// (p50/p90/p99) ومعدّل الإنتاجية ونسبة الأخطاء. مناسب لـ CI وللتشخيص قبل الإطلاق.
//
// التشغيل:
//   BASE_URL=https://nova-backend-xxxx.run.app \
//   LOAD_TOKEN=<jwt> \
//   LOAD_CONCURRENCY=20 LOAD_DURATION_MS=15000 \
//   node scripts/load-test.mjs
//
// متغيّرات اختيارية:
//   LOAD_PATHS  مسارات مفصولة بفواصل (افتراضي: مسارات صحّة عامّة)
//   LOAD_MAX_ERROR_RATE  أقصى نسبة أخطاء مقبولة (افتراضي 0.05) — يخرج بـ 1 إذا تجاوزها
//
// ملاحظة: لا يُنشئ أي بيانات — يقتصر على طلبات GET لقياس الأداء.

import http from "node:http";
import https from "node:https";

const BASE = (process.env.BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const API = BASE.endsWith("/api") ? BASE : `${BASE}/api`;
const TOKEN = process.env.LOAD_TOKEN ?? "";
const CONCURRENCY = Math.max(1, Number(process.env.LOAD_CONCURRENCY ?? 10));
const DURATION_MS = Math.max(1000, Number(process.env.LOAD_DURATION_MS ?? 10000));
const MAX_ERROR_RATE = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0.05);
const TIMEOUT_MS = Number(process.env.LOAD_TIMEOUT_MS ?? 15000);
const PATHS = (process.env.LOAD_PATHS ?? "/health,/health/ready")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

function requestOnce(path) {
  const url = new URL(API + path);
  const client = url.protocol === "https:" ? https : http;
  const started = process.hrtime.bigint();
  return new Promise((resolve) => {
    const req = client.request(
      url,
      {
        method: "GET",
        headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          resolve({ ok: (res.statusCode ?? 500) < 500, status: res.statusCode, ms });
        });
      },
    );
    req.on("error", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ok: false, status: 0, ms });
    });
    req.on("timeout", () => {
      req.destroy();
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ok: false, status: 0, ms });
    });
    req.end();
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function worker(deadline, state) {
  let i = 0;
  while (Date.now() < deadline) {
    const path = PATHS[i++ % PATHS.length];
    const r = await requestOnce(path);
    state.latencies.push(r.ms);
    state.total++;
    if (!r.ok) state.errors++;
  }
}

async function main() {
  console.log(
    `\u062d\u0650\u0645\u0644: ${CONCURRENCY} \u0639\u0627\u0645\u0644 \u00d7 ${DURATION_MS}ms \u2192 ${API} \u0639\u0644\u0649 ${PATHS.join(", ")}`,
  );
  const state = { latencies: [], total: 0, errors: 0 };
  const deadline = Date.now() + DURATION_MS;
  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker(deadline, state)),
  );
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const sorted = state.latencies.slice().sort((a, b) => a - b);
  const errorRate = state.total > 0 ? state.errors / state.total : 1;
  const rps = state.total / elapsedSec;

  console.log(`\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0637\u0644\u0628\u0627\u062a: ${state.total}`);
  console.log(`\u0627\u0644\u0625\u0646\u062a\u0627\u062c\u064a\u0629: ${rps.toFixed(1)} \u0637\u0644\u0628/\u062b\u0627\u0646\u064a\u0629`);
  console.log(`\u0627\u0644\u0623\u062e\u0637\u0627\u0621: ${state.errors} (${(errorRate * 100).toFixed(2)}%)`);
  console.log(
    `\u0627\u0644\u0632\u0645\u0646 (ms) p50=${percentile(sorted, 50).toFixed(1)} p90=${percentile(sorted, 90).toFixed(1)} p99=${percentile(sorted, 99).toFixed(1)}`,
  );

  if (errorRate > MAX_ERROR_RATE) {
    console.error(
      `\u274c \u0646\u0633\u0628\u0629 \u0627\u0644\u0623\u062e\u0637\u0627\u0621 ${(errorRate * 100).toFixed(2)}% \u062a\u062c\u0627\u0648\u0632\u062a \u0627\u0644\u062d\u062f\u0651 ${(MAX_ERROR_RATE * 100).toFixed(2)}%`,
    );
    process.exit(1);
  }
  console.log("\u2705 \u0636\u0645\u0646 \u0627\u0644\u062d\u062f\u0651 \u0627\u0644\u0645\u0642\u0628\u0648\u0644");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
