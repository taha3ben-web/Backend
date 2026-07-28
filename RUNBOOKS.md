# NOVA Ride — Operational Runbooks (دليل الاستجابة للحوادث)

> كل runbook يربط **تنبيهًا (alert kind)** بخطوات التشخيص والمعالجة. التنبيهات
> تُرسل عبر `AlertService` إلى `ALERT_WEBHOOK_URL` (Slack أو webhook عام) وتُسجّل دائمًا
> محليًا مع `requestId`/`traceId`. كل سطر سجلّ (log) يحمل `traceId`؛ ابحث به لربط
> كامل رحلة الطلب عبر الخدمات.

## كيف تقرأ التتبّع (Tracing)

- كل طلب HTTP يحصل على `requestId` و`traceId` من `RequestContextMiddleware`.
- ندعم سياق W3C `traceparent` الوارد/الصادر (متوافق مع OpenTelemetry).
- `TracerService.withSpan(name, fn, attrs)` يُنشئ span ويُصدّره كـ JSON (`{"type":"span",...}`).
- للتفعيل/التعطيل: `TRACING_ENABLED` (افتراضيًا مُفعّل). لإبدال المُصدّر بـ OTLP
  استبدل `TracerService.emit` فقط (نفس العقد).

## متغيرات البيئة ذات الصلة

| المتغير | الوصف | افتراضي |
| --- | --- | --- |
| `ALERT_WEBHOOK_URL` | وجهة التنبيهات (Slack incoming webhook أو أي webhook) | لا شيء (تسجيل محلي فقط) |
| `ALERT_THROTTLE_MS` | نافذة خنق تكرار نفس التنبيه | `300000` (5 دقائق) |
| `TRACING_ENABLED` | تفعيل تصدير الـ spans | `true` |
| `METRICS_TOKEN` | حماية نقطتي `/api/metrics` و`/api/metrics/prometheus` | لا شيء (مفتوح — تطوير فقط) |
| `METRICS_MAX_SERIES` | سقف سلاسل مقاييس HTTP في الذاكرة | `500` |

---

## 1) `reconciliation.mismatch` — عدم تطابق رصيد حساب (🚨 CRITICAL)

**المعنى:** رصيد الحساب المخزّن (`balanceCache`) لا يطابق المشتقّ من دفتر الأستاذ (مصدر الحقيقة).

**التشخيص:**
1. افتح لوحة الحوادث: `GET /api/dashboard/ops` أو `GET /api/financial/reconciliation/incidents?status=OPEN`.
2. حدّد `accountCode` من سياق التنبيه؛ راجع `difference` (+ يعني المخزّن أعلى).
3. شغّل فحصًا يدويًا للتأكيد: `POST /api/financial/reconciliation/run`.

**المعالجة:**
- لا تُعدّل `balanceCache` يدويًا أبدًا. دفتر الأستاذ هو المصدر.
- أعد بناء المخزّن من الإدخالات (دالة `reconcileLedgerBalances`) بعد تأكيد السبب.
- إذا وُجدت معاملة ناقصة (مثل webhook دفع لم يُرحّل)، عالجها عبر الـ Outbox/DLQ.
- بعد الحلّ: `POST /api/financial/reconciliation/incidents/:id/resolve`.

**التصعيد:** إن تجاوز `difference` عتبة المال الجوهري، أبلغ مسؤول المالية فورًا.

---

## 2) `reconciliation.summary` — تقرير الفحص الدوري (🚨 CRITICAL)

**المعنى:** cron كل 30 دقيقة وجد اختلافًا أو أكثر.

**المعالجة:** اتبع runbook رقم 1 لكل حادثة مفتوحة. العدد التراكمي للحوادث مؤشر خطر نظامي.

---

## 3) `settlement.failed` — فشل تسوية رحلة (⚠️ WARNING)

**المعنى:** `settleTrip` فشلت وانتقلت الحالة إلى `FAILED`.

**التشخيص:**
1. `GET /api/financial/settlement/queue?onlyFailed=true`.
2. ابحث في السجلات بـ `traceId` لرؤية السبب الجذري.

**المعالجة:**
- أعد المحاولة: `POST /api/financial/settlement/run` مع `onlyFailed=true` (مُتعادل — idempotent عبر مفتاح `trip:settle:<id>`).
- إن تكرّر الفشل، راجع انتقالات حالة التسوية (`canSettlementTransition`).

---

## 4) `outbox.dead` — حدث عالق في DLQ (⚠️ WARNING)

**المعنى:** حدث في صندوق الإرسال (Outbox) تجاوز الحد الأقصى للمحاولات وانتقل إلى `DEAD`.

**المعالجة:**
1. افحص الأحداث الميتة وسبب الفشل المخزّن.
2. بعد إصلاح المستهلك، أعد جدولة الحدث (إعادة إلى `PENDING`).

---

## 5) `risk.blocked` / `risk.review` — احتيال محتمل (⚠️ WARNING)

**المعنى:** محرك المخاطر حجب عملية أو أحالها للمراجعة.

**المعالجة:**
1. `GET /api/risk/reviews?status=PENDING`.
2. راجع الحدث، واتخذ قرارًا (قبول/رفض/قائمة حظر).

---

## 6) انقطاع Redis / الطابور (🚨 CRITICAL)

**المعنى:** فشل الاتصال بـ Redis يعطّل الأقفال الموزّعة والـ realtime.

**المعالجة:**
1. تحقق من `GET /api/health`.
2. الأقفال الموزّعة تمنع السحب المزدوج؛ أثناء الانقطاع أوقف عمليات السحب حتّى التعافي.

---

### ملحوظة عامة
كل التقارير المالية مشتقّة من دفتر الأستاذ (مصدر الحقيقة الوحيد). لا تعتمد على حقول
مخزّنة مؤقتة عند اتخاذ قرارات مالية.

---

## 7) النسخ الاحتياطي والتعافي من الكوارث (Backup / DR)

- **الرصد:** لوحة التحكّم `/backups` → حالة DR (`computeDrStatus`) تقارن عمر آخر نسخة ناجحة بـ RPO.
- **إذا ظهر breached=true:** تحقّق من مهمّة النسخ المجدولة، ثم شغّل نسخة يدوية (trigger=MANUAL).
- **الاستبقاء (GFS):** `selectRetained` يحدّد النسخ المُبقاة/المُقلّمة حسب `DEFAULT_RETENTION_POLICY`.
- التفاصيل: وحدة `src/modules/backups/` (المرحلة 73).

## 8) صحّة الطابور الخلفي (Queue Health)

- **الرصد:** `/queue-health` → `insight` يُرجِع شدّة (healthy/warn/crit) حسب التراكم والتقادم ونسبة DLQ.
- **تراكم مرتفع / توقّف (stalled):** راجع `backlog-by-name` لتحديد الحدث المتأخّر، ثم تحقّق من المستهلِك.
- **DLQ:** `dead-letters` للعرض، و`dead-letters/retry-all` لإعادة الجدولة (payments.manage).
- **التنظيف:** `purge-delivered` (settings.manage) يعتمد فهرس `OutboxEvent(status, deliveredAt)`.
- التفاصيل: وحدة `src/modules/queue-insight/` (المرحلة 74).

## 9) صحّة Webhooks بوّابات الدفع (PSP)

- **الرصد:** `/payment-gateways` → `webhook-health` (`classifyWebhookHealth`) يُقيّم نسبة الفشل والتقادم.
- **critical/unprotected:** تأكّد من ضبط `PAYMENT_WEBHOOK_SECRET`/`PAYMENT_WEBHOOK_TOKEN` ومخطّط التوقيع `PAYMENT_WEBHOOK_SCHEME`.
- **أحداث حديثة:** `recent-events` يعتمد فهارس `PaymentEvent(createdAt)` و`(status, createdAt)`.
- التفاصيل: وحدة `src/modules/payment-gateways/` (المرحلة 75)؛ تحقّق التوقيع في `payments/webhooks`.

## 10) نشر مايجريشن الفهارس واختبار الحِمل

- **النشر:** `npx prisma migrate deploy`. مايجريشن الفهارس إضافية غير كاسرة.
- **جداول ضخمة:** في الإنتاج يُفضّل `CREATE INDEX CONCURRENTLY` يدويًّا خارج معاملة لتجنّب القفل.
- **قياس الأداء:** `BASE_URL=... LOAD_TOKEN=... npm run load` → يطبع p50/p90/p99 ونسبة الأخطاء، ويخرج بـ 1 عند تجاوز الحدّ.
- التفاصيل: ADR-0006؛ `scripts/load-test.mjs`.

---

## 11) أهداف مستوى الخدمة (SLOs) وعتبات التنبيه

> المصدر الحيّ لهذه المؤشرات هو `GET /api/metrics` (مفتاح `http`) و`GET /api/metrics/prometheus`.
> كل سلسلة قابلة للرسم مباشرةً في Grafana. القياس نافذة منزلقة منذ إقلاع العملية.

### مؤشرات التوفّر والكمون (Availability & Latency)

| المؤشر | مصدر Prometheus | SLO الهدف | عتبة تحذير | عتبة حرجة | الإجراء |
| --- | --- | --- | --- | --- | --- |
| معدل أخطاء 5xx | `errorRate` / `nova_http_requests_total{status=~"5.."}` | < 0.5% | ≥ 1% لخمس دقائق | ≥ 5% لدقيقتين | راجع runbook 12؛ افحص أعلى المسارات في `topRoutes` |
| كمون p95 | `p95Ms` / histogram `nova_http_request_duration_seconds` | < 400ms | ≥ 800ms لعشر دقائق | ≥ 1500ms لخمس دقائق | حدّد المسار البطيء من `topRoutes`، افحص DB/Redis/OSRM |
| كمون p99 | `p99Ms` | < 1000ms | ≥ 2000ms | ≥ 4000ms | كما أعلاه؛ راجع الأقفال الموزّعة والاستعلامات البطيئة |
| توفّر قاعدة البيانات | `nova_db_up` / `nova_db_latency_ms` | = 1 | latency ≥ 250ms | = 0 (تعطّل) | runbook 6؛ افحص Neon والـ pooler |
| توفّر Redis | `nova_redis_up` / `nova_redis_latency_ms` | = 1 | latency ≥ 100ms | = 0 (تعطّل) | runbook 6 |
| انفجار الكاردينالية | `nova_http_series_dropped_total` | = 0 | > 0 (نموّ) | نموّ مستمر | ارفع `METRICS_MAX_SERIES` أو أضف تطبيعًا لمسار جديد |

### مؤشرات الأعمال المالية (Business SLOs)

| المؤشر | العتبة الحرجة | الإجراء |
| --- | --- | --- |
| اختلافات دفتر الأستاذ (`reconciliation.mismatch`) | ≥ 1 حادثة مفتوحة | runbook 1 فورًا — لا تتجاهله أبدًا |
| عمق طابور التسوية الفاشلة | تراكم يتزايد عبر فحصين متتاليين | runbook 3 |
| نسبة `ride:no_drivers` | ≥ 30% من الطلبات في منطقة/فترة | راجع كثافة السائقين وSEARCH_RADIUS_KM والتصاعد |
| أحداث DLQ (`outbox.dead`) | ≥ 1 | runbook 4 |

### مبدأ التنبيه

- **الصفحة (Page) فقط للحرج:** تعطّل DB/Redis، اختلاف دفتر الأستاذ، معدّل 5xx حرج.
- **التحذيرات تُوجَّه لقناة غير مُوقِظة** وتُراجَع في ساعات العمل.
- كل تنبيه يجب أن يشير إلى runbook برقمه؛ تنبيه بلا إجراء = ضجيج يُحذف.
- خنق التكرار عبر `ALERT_THROTTLE_MS` (افتراضيًا 5 دقائق) يمنع عواصف التنبيهات.

---

## 12) `http.error_rate` / `http.latency` — تدهور الخدمة (🚨 CRITICAL / ⚠️ WARNING)

**المعنى:** مقاييس HTTP الحيّة تجاوزت عتبات SLO في القسم 11.

**التشخيص:**
1. `GET /api/metrics` → افحص `http.errorRate` و`http.p95Ms` و`http.p99Ms` و`http.topRoutes`.
2. حدّد المسار الأكثر إسهامًا في الأخطاء/البطء من `topRoutes` (مطبَّع، مثل `/api/trips/:id`).
3. ابحث في السجلات بـ `traceId` لطلبات ذلك المسار خلال نافذة التدهور.

**المعالجة:**
- إن كان المصدر DB/Redis: runbook 6.
- إن كان المصدر مزوّدًا خارجيًا (OSRM/Chargily/Firebase/Twilio): افحص زمن استجابته وحالة الدائرة القاطعة (المرحلة 5).
- إن كان مسارًا واحدًا: راجع آخر نشر لذلك المسار وأعد التدحرج إن لزم.
