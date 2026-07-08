#!/usr/bin/env node
// فحص دخان (Smoke Test) مستقل لخادم NOVA — يُستخدم بعد النشر للتحقق السريع.
//
// التشغيل:
//   BASE_URL=https://nova-backend-xxxx.run.app node scripts/smoke.mjs
//   (افتراضيًا http://localhost:4000)
//
// اختياري: SMOKE_EMAIL / SMOKE_PASSWORD لاختبار تسجيل الدخول.
//
// يخرج برمز 0 عند نجاح كل الفحوص، وبرمز 1 عند فشل أي فحص (مناسب لـ CI).

const BASE = (process.env.BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const API = BASE.endsWith("/api") ? BASE : `${BASE}/api`;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);

let passed = 0;
let failed = 0;

function ok(name, extra = "") {
  passed++;
  console.log(`\u2705 ${name}${extra ? " \u2014 " + extra : ""}`);
}
function fail(name, reason) {
  failed++;
  console.error(`\u274c ${name} \u2014 ${reason}`);
}

async function req(path, { method = "GET", body, token } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`\u2192 NOVA smoke test against ${API}\n`);

  // 1) Liveness
  try {
    const r = await req("/health/live");
    if (r.status === 200 && r.data?.ok) ok("GET /health/live", `uptime=${r.data.uptimeSec}s`);
    else fail("GET /health/live", `status=${r.status}`);
  } catch (e) {
    fail("GET /health/live", e.message);
  }

  // 2) Readiness (DB + Redis)
  try {
    const r = await req("/health/ready");
    const c = r.data?.checks;
    if (r.status === 200 && r.data?.ok) {
      ok("GET /health/ready", `db=${c?.db?.latencyMs}ms redis=${c?.redis?.latencyMs}ms`);
    } else {
      fail("GET /health/ready", `status=${r.status} checks=${JSON.stringify(c)}`);
    }
  } catch (e) {
    fail("GET /health/ready", e.message);
  }

  // 3) الحراسة فعّالة — مسار محمي يجب أن يعيد 401 دون توكن
  try {
    const r = await req("/driver/me");
    if (r.status === 401) ok("GET /driver/me بلا توكن → 401 (الحراسة تعمل)");
    else fail("GET /driver/me", `متوقع 401 لكن status=${r.status}`);
  } catch (e) {
    fail("GET /driver/me", e.message);
  }

  // 4) التحقق من المدخلات — جسم خاطئ يجب أن يُرفض (400) وليس 500
  try {
    const r = await req("/auth/login", { method: "POST", body: { bogus: true } });
    if (r.status === 400) ok("POST /auth/login بجسم خاطئ → 400 (التحقق يعمل)");
    else if (r.status === 401) ok("POST /auth/login → 401 (مقبول)");
    else fail("POST /auth/login", `متوقع 400/401 لكن status=${r.status}`);
  } catch (e) {
    fail("POST /auth/login", e.message);
  }

  // 5) اختياري: تسجيل دخول حقيقي إن توفّرت البيانات
  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
    try {
      const r = await req("/auth/login", {
        method: "POST",
        body: {
          email: process.env.SMOKE_EMAIL,
          password: process.env.SMOKE_PASSWORD,
        },
      });
      if (r.status === 200 && r.data?.accessToken) {
        ok("POST /auth/login ببيانات صحيحة → 200 + توكن");
        const me = await req("/auth/me", { token: r.data.accessToken }).catch(() => null);
        if (me && me.status === 200) ok("GET /auth/me بالتوكن → 200");
      } else {
        fail("POST /auth/login (حقيقي)", `status=${r.status}`);
      }
    } catch (e) {
      fail("POST /auth/login (حقيقي)", e.message);
    }
  }

  console.log(`\n————————————————————————`);
  console.log(`النتيجة: ${passed} نجح / ${failed} فشل`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("خطأ فادح في فحص الدخان:", e);
  process.exit(1);
});
