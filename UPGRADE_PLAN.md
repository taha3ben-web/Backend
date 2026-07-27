# flaminGO Backend — خطة الترقية التنفيذية (مراحل)

> المرجع: `BACKEND_FULL_AUDIT*.md`. هذا الملف هو **قائمة عمل تنفيذية** لا تقريرًا.
> الترتيب مقصود: كل مرحلة تعتمد على ما قبلها. لا تقفز مرحلة.

---

## المرحلة 0 — قفل الأمن العاجل (يوم واحد)

| # | المهمة | الملفات | الحالة |
|---|---|---|---|
| 0.1 | `@Public()` decorator جديد | `src/common/decorators/public.decorator.ts` | ✅ |
| 0.2 | `JwtAuthGuard` يحترم `@Public()` ويتجاهل سياقات غير HTTP | `src/common/guards/jwt-auth.guard.ts` | ✅ |
| 0.3 | ترقية `JwtAuthGuard` + `RolesGuard` إلى `APP_GUARD` عالمي | `src/app.module.ts` | ✅ |
| 0.4 | وسم المسارات العامة فقط بـ `@Public()` | auth / health / webhooks / bootstrap / legal / app-versions / metrics | ✅ |
| 0.5 | إصلاح توقيع webhook ليُحسب على `rawBody` | `main.ts` + `payment-webhooks.controller.ts` | ✅ |
| 0.6 | حذف `.env` من المستودع وتقوية `.gitignore`/`.dockerignore` | الجذر | ✅ |
| 0.7 | **تدوير كل الأسرار يدويًا** (JWT، DB، Redis، Firebase، webhook، metrics) | خارج الكود | ⚠️ مطلوب منك |

**معيار الإنجاز:** أي مسار جديد يُكتب مستقبلًا يكون **محميًا تلقائيًا** دون أي تدخل.

---

## المرحلة 1 — محرك التوجيه الحقيقي (أخطر خلل في المنتج) — منجزة

> تصحيح مهم للتقرير: تجريد مزوّد الخرائط (`GeoProvider` + `directions()` + مزوّد Google
> + ترميز polyline) كان **موجودًا فعلًا** في `src/modules/geo/`. المشكلة الحقيقية أن التسعير
> والمطابقة لم يستخدماه أبدًا وكانا يحسبان Haversine مباشرة. لذلك تمّ **البناء على
> الموجود وربطه** لا إنشاء وحدة `routing/` موازية.

| # | المهمة | الملفات | الحالة |
|---|---|---|---|
| 1.1 | `RoutingService` موحّد: `route()` + `etaFromMany()` يُرجع `{distanceMeters, durationSeconds, polyline}` | `src/modules/geo/routing.service.ts` | ✅ |
| 1.2 | محول OSRM (الافتراضي الموصى به، مستضاف ذاتيًا) + `/table` للـ ETA الجماعي | `geo/providers/osrm-geo.provider.ts` | ✅ |
| 1.3 | محول Google Directions | `geo/providers/google-geo.provider.ts` | ✅ كان موجودًا |
| 1.4 | كاش Redis لأزواج الإحداثيات (grid snapping 4 خانات ≈ 11 مترًا + TTL 300s) | `routing.service.ts` | ✅ |
| 1.5 | ارتداد إلى الحساب التقريبي عند فشل المزوّد + وسم `approximate` | `routing.service.ts` | ✅ |
| 1.6 | ربط التسعير بالتوجيه بدل `haversineKm`/`estimateDurationSec` | `pricing-engine.service.ts` + `pricing-engine.module.ts` | ✅ |
| 1.7 | ربط المطابقة بـ ETA حقيقي + استراتيجية `FASTEST_ETA` افتراضية | `matching/engine/*` + `redis.service.ts` (`nearbyDriversWithCoords`) | ✅ |
| 1.8 | تخزين `routePolyline` و `routeProvider` على الرحلة | `prisma/schema.prisma` + migration `20260727020000_trip_route_polyline` + `matching.service.ts` | ✅ |
| 1.9 | تشغيل خدمة OSRM فعليًا وضبط `maps.provider = "osrm"` | `docker-compose.yml` (المرحلة 3) + لوحة التحكم | ⚠️ خطوة نشر |

**ما يجب أن تفعله أنت لتفعيل المرحلة:**

1. `npx prisma migrate deploy` (أو `migrate dev`) لتطبيق عمودي `routePolyline` / `routeProvider`.
2. تشغيل OSRM على بيانات الجزائر (صورة `osrm/osrm-backend`، ملف `algeria-latest.osm.pbf`).
3. ضبط `OSRM_BASE_URL` أو الإعداد `maps.osrmBaseUrl`، ثم `maps.provider = "osrm"`.

**معيار الإنجاز:** لا يوجد في الكود أي مسار يحسب أجرة أو يرتّب سائقًا بمسافة هوائية
دون محاولة التوجيه أولًا، وكل نتيجة تقريبية موسومة بـ `approximate`.

---

## المرحلة 2 — المزودون الحقيقيون — منجزة (بقرار تشغيلي: Firebase + نقدًا/محفظة)

القرار المعتمد: **التحقق من الهاتف عبر Firebase Phone Auth فقط**، و**الدفع نقدًا ومن المحفظة فقط**، وChargily لاحقًا.

| # | المهمة | الحالة |
| --- | --- | --- |
| 2.1 | مفتاح قناة التحقق `AUTH_OTP_CHANNEL=firebase\|sms` (الافتراضي `firebase`) | ✅ |
| 2.2 | إلغاء النجاح الوهمي في `requestOtp`: لا `sent: true` إلا بتسليم فعلي، وحذف الرمز من Redis عند الفشل | ✅ |
| 2.3 | وضع تطوير محمي: `OTP_DEV_MODE=true` يعمل فقط خارج `NODE_ENV=production` | ✅ |
| 2.4 | تشديد جسر Firebase: رفض الرمز بلا `phone_number` أو بريد مُتحقّق، ومنع الثقة برقم العميل | ✅ |
| 2.5 | سجل محوّلات دفع (`PaymentAdapter`) + محوّل نقدًا + محوّل محفظة | ✅ |
| 2.6 | إلغاء `capture/refund/cancel` الوهمية: مزوّد بلا محوّل يرمي خطأً ولا يُبلّغ عن نجاح | ✅ |
| 2.7 | هيكل محوّل Chargily جاهز (غير مسجل ويرمي خطأً واضحًا حتى يكتمل) | ✅ |
| 2.8 | مسار سحب خارجي (payout rail) مربوط بـ `withdrawals` | ⏸ معلّق — لا مزوّد مختار بعد |
| 2.9 | مزوّد Email مع قوالب موحدة | ⏸ مأجل (غير حاجز للإطلاق) |

### ملاحق التفعيل

1. اضبط بيانات Firebase Admin: `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`. بدونها يُرفض كل دخول عبر `POST /auth/firebase`.
2. اترك `AUTH_OTP_CHANNEL` فارغًا (أو `firebase`). مسارا `/auth/otp/request` و`/auth/otp/verify` سيردّان 400 مع رسالة توجّه لـ Firebase.
3. لتفعيل Chargily لاحقًا: املأ `providers/payment-adapter.ts` في `ChargilyPaymentAdapter` ثم `register(new ChargilyPaymentAdapter())` — لا حاجة لمس الدفتر المالي.

---

## المرحلة 3 — فصل الـ Worker وأقفال الـ Cron — منجزة

| # | المهمة | الحالة |
| --- | --- | --- |
| 3.1 | `runExclusive` في `DistributedLockService`: محاولة واحدة دون انتطار + تخطّي صامت | ✅ |
| 3.2 | قفل موزّع على الـ 11 مهمة cron جميعها (TTL مناسب لكل دورة) | ✅ |
| 3.3 | `APP_ROLE=api\|worker\|all` و`SCHEDULER_ENABLED` في `app.module.ts` | ✅ |
| 3.4 | `ScheduleModule.forRoot()` مشروط بالدور (مزيّنات @Cron خاملة في نسخ api) | ✅ |
| 3.5 | `docker-compose.yml`: خدمة `worker` منفصلة + خدمة `osrm` تموّل `OSRM_BASE_URL` | ✅ |
| 3.6 | `cloudbuild.yaml`: نشر `${_SERVICE}-worker` بـ `APP_ROLE=worker` و`--no-cpu-throttling` | ✅ |

### مفاتيح الأقفال المستخدمة

`cron:outbox-relay` · `cron:financial-retry-trips` · `cron:financial-retry-penalties` ·
`cron:ledger-reconciliation` · `cron:reap-stuck-searches` · `cron:notifications-due` ·
`cron:scheduled-trips-activate` · `cron:fare-offers-expire` · `cron:driver-sanctions` ·
`cron:support-escalations` · `cron:subscriptions-renew`

### ملاحق التفعيل

1. في الإنتاج: اضبط `APP_ROLE=api` على نسخ الطلبات و`APP_ROLE=worker` على عملية المهام.
2. إن تركته فارغًا (`all`) يبقى السلوك القديم — مقبول لنسخة واحدة وللتطوير.
3. القفل يحتاج Redis. بدونه يعمل القفل صوريًا (نسخة واحدة فقط مقبولة).

---

## المرحلة 4 — المراقبة والجودة

1. Sentry + OpenTelemetry مع تتبع موزع.
2. تنبيهات على عتبات: فشل تسوية، اختلال دفتر، طول طابور Outbox، p95.
3. `strict: true` في TypeScript تدريجيًا من الوحدات المالية.
4. تفكيك `financial.service.ts` (1,991 سطرًا) إلى 4 خدمات.
5. رفع تغطية الاختبار إلى 60% على المسارات المالية + e2e.
6. كاش Redis للإعدادات وأعلام الميزات وقواعد الأسعار.
7. ترقيم cursor-based للرحلات والمعاملات.

---

## المرحلة 5 — ميزات المنافسة العالمية

1. طبقة الأمان: SOS، مشاركة رحلة برابط مؤقت، جهات طوارئ، كشف الانحراف.
2. Surge حي مربوط بطلب/عرض لكل خلية + خريطة طلب للسائق.
3. تحديات ومكافأت للسائقين، إكرامية، إحالة وولاء.
4. أرقام مقنعة VoIP، مفقودات، فواتير PDF رسمية.
5. تقسيم جداول التتبع/الرحلات + Read Replica.

## المرحلة 4 — المراقبة والأداء (مكتملة)

| # | البند | الملف | الحالة |
|---|------|------|-------|
| 4.1 | مراسل أخطاء متوافق مع Sentry (Envelope API عبر fetch، بلا SDK) | `src/common/observability/error-reporter.service.ts` | ✅ |
| 4.2 | رفع كل أخطاء 5xx تلقائيًا من المُرشّح العام | `src/common/filters/all-exceptions.filter.ts` | ✅ |
| 4.3 | التقاط `unhandledRejection` و`uncaughtException` | `src/main.ts` | ✅ |
| 4.4 | مُصدّر OTLP/HTTP للـ spans (Tempo / Jaeger / Collector) مع دفعات | `src/common/observability/otlp-exporter.ts` | ✅ |
| 4.5 | ربط المُصدّر بـ `TracerService` دون تغيير أي موضع استدعاء | `src/common/observability/tracer.service.ts` | ✅ |
| 4.6 | ترقيم بالمؤشر (keyset) للجداول الكبيرة | `src/common/query.util.ts` | ✅ |
| 4.7 | تشديد TypeScript تدريجي بملف منفصل + `npm run typecheck:strict` | `tsconfig.strict.json`, `package.json` | ✅ |
| 4.8 | متغيرات البيئة للمراقبة | `.env.example` | ✅ |
| 4.9 | تقسيم `financial.service.ts` (1991 سطرًا) إلى 4 خدمات | — | ⏸ مُؤجّل عمدًا |
| 4.10 | ذاكرة Redis للإعدادات والأعلام | — | ⏸ المرحلة 5 |

### لماذا تأجّل 4.9 (بصراحة)

تقسيم الطبقة المالية تغيير ميكانيكي واسع على أخطر ملف في المشروع (قيود محاسبية،
تسويات، مطابقة). في بيئة العمل الحالية لا توجد `node_modules`، فلا يمكن تشغيل
`tsc` ولا `jest` للتحقّق من التقسيم. تقسيم أعمى قد يكسر البناء أو — وهو أسوأ —
يكسر ترتيب المعاملات داخل معاملة واحدة. الخطة المقترحة عند توفّر البناء والاختبارات:
`LedgerService` (قيود) · `SettlementService` (تسوية الرحلات) · `ReconciliationService` (المطابقة والمهام
المجدولة) · `FinancialQueryService` (القراءات والتقارير)، مع بقاء `FinancialService`
واجهة رقيقة تفوّض لها حتّى لا يتغيّر أي موضع استدعاء أو اختبار.

### تفعيل المرحلة 4

1. `SENTRY_DSN` → تبدأ الأخطاء بالوصول فورًا. دونه لا يحدث شيء (لا خطأ ولا إرسال وهمي).
2. `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` → تُدفع الـ spans إلى `/v1/traces`.
3. `ALERT_WEBHOOK_URL` → تنبيهات Slack (الخدمة موجودة من قبل ومربوطة بـ dedup/throttle).
4. `npm run typecheck:strict` يُظهر قائمة أخطاء التشديد دون أن يكسر `npm run build`.

## المرحلة 5 — السلامة (الجزء الأول مكتمل)

### عيوب خطيرة اكتُشفت وأُصلحت

| # | العيب | الأثر قبل الإصلاح | الحالة |
|---|------|------------------|-------|
| 5.1 | جدول `SafetyIncident` موجود في الهجرة `20260712150000_p1_safety_incidents` لكنّه **ساقط من `schema.prisma`** | `prisma.safetyIncident` غير مولّد → وحدة الطوارئ تكسر البناء | ✅ أُعيد النموذج مطابقًا حرفيًا للـ SQL |
| 5.2 | `SafetyService` و`SafetyController` **غير مسجّلين في أي وحدة** | مسارات `POST /api/safety/incidents` غير موجودة أصلًا (404) | ✅ سُجّلت في `EmergencyModule` |
| 5.3 | الـ SOS يُخزّن في الجدول ولا يُبلّغ أحدًا | طمأنينة كاذبة للراكب | ✅ تنبيه CRITICAL + SMS لجهات الطوارئ |

### إضافات

| # | البند | الملف |
|---|------|------|
| 5.4 | نموذج `TripShareToken` + هجرة `20260727050000_trip_share_tokens` | `prisma/` |
| 5.5 | خدمة مشاركة الرحلة (رمز 32 بايت، يُخزّن مجزّأ SHA-256، انتهاء وإبطال وعدّاد مشاهدات) | `emergency/trip-share.service.ts` |
| 5.6 | متحكّمان: محمي (إنشاء/سرد/إبطال) وعام `@Public()` للمتابعة بلا حساب | `emergency/trip-share.controller.ts` |

### مسارات جديدة

- `POST /api/safety/share` — إنشاء رابط متابعة (افتراضي 4 ساعات، أقصى 12).
- `GET /api/safety/share/trip/:tripId` — الروابط النشطة.
- `DELETE /api/safety/share/:id` — إبطال فوري.
- `GET /api/safety/share/:token` — عام: حالة الرحلة + آخر موقع + المسار + اسم السائق ولوحة السيارة فقط.

### متبقٍ في المرحلة 5

كشف انحراف المسار، خريطة حرارية للطلب مع تسعير ذروة حيّ، إخفاء أرقام الهواتف (VoIP)،
فواتير PDF، وتقسيم جدول التتبّع.

> ⚠️ بعد السحب: `npx prisma generate && npx prisma migrate deploy` إلزامي لأن المخطّط تغيّر.

## المرحلة 5 — الجزء الثاني: التسعير الديناميكي الحيّ ✅

### العيب

الملف `pricing-engine/surge.util.ts` كان مكتوبًا بالكامل (دوال نقية ومختبرة) لكنّه
**لم يكن مستدعى من أي ملف في المشروع**. المضاعف الوحيد المطبّق كان `peakMultiplier`
الثابت في قاعدة السعر: السعر لا يرتفع عند ندرة السائقين ولا يوجد أي حافز
يدفع السائقين نحو مناطق الطلب — وهذا أحد أسباب طول زمن الانتظار وقت الذروة.

### ما أُنجز

| # | البند | الملف | الحالة |
|---|------|------|-------|
| 5.7 | `SurgeService`: الطلب = رحلات `SEARCHING` خلال 10 دقائق داخل 3 كم؛ العرض = السائقون المتاحون فعليًا في Redis GEO | `pricing-engine/surge.service.ts` | ✅ |
| 5.8 | ربط المضاعف بـ `quote()`: `peak × liveSurge` ثمّ حصر بسقف المدينة `cappedSurge` | `pricing-engine.service.ts` | ✅ |
| 5.9 | شفافية: حقل `breakdown.surgeMultiplier` في كل عرض سعر | `pricing-engine.service.ts` | ✅ |
| 5.10 | تخزين لكل خلية جغرافية (≈ 1.1 كم) لمدة 60 ثانية — يمنع تذبذب السعر بين طلبين متتاليين | `surge.service.ts` | ✅ |
| 5.11 | خريطة حرارية للطلب + مسارات قراءة | `pricing-engine/surge.controller.ts` | ✅ |
| 5.12 | مفاتيح بيئة للضبط والإيقاف الفوري | `.env.example` | ✅ |

### مسارات جديدة

- `GET /api/surge?lat=..&lng=..` — المضاعف الحالي مع الطلب والعرض الفعليين ومصدر القيمة.
- `GET /api/surge/heatmap?minutes=10` — خلايا الطلب مرتّبة تنازليًا (حتّى 300 خلية) لتطبيق السائق.

### مبدأ الأمان

أي خلل (Redis معطّل، استعلام فاشل، إحداثيات ناقصة) يُرجع مضاعفًا = 1 أي السعر العادي.
لا يجوز أبدًا أن يرفع خطأ تقني فاتورة الراكب. و`SURGE_ENABLED=false` يُعيد السلوك القديم فورًا.

### متبقٍ

كشف انحراف المسار، إخفاء أرقام الهواتف (VoIP)، المفقودات، فواتير PDF، تقسيم جدول التتبّع.

## المرحلة 5 — الجزء الثالث: كشف انحراف المسار ✅

### العيب

بعد المرحلة 1 صار لكل رحلة `routePolyline` حقيقي، وجدول `TripTracking` ممتلئ بنقاط GPS،
لكنّ **لا أحد كان يقارن بينهما**. السائق يمكنه الابتعاد كيلومترات عن الطريق بلا أي إنذار،
وهذا أساس مركزي في أمان الراكب لدى Uber/Bolt.

| # | البند | الملف | الحالة |
|---|------|------|-------|
| 5.13 | `decodePolyline` + `distanceToSegmentMeters` + `distanceToPathMeters` (دوال نقية) | `geo/geo.util.ts` | ✅ |
| 5.14 | `RouteDeviationService`: عتبة 600 متر × 3 نقاط متتالية، إنذار واحد لكل رحلة | `trips/route-deviation.service.ts` | ✅ |
| 5.15 | ربط الفحص بـ `recordTracking` (أفضل-جهد، لا يحجب البثّ الحيّ) | `trips/trips.service.ts` | ✅ |
| 5.16 | تنظيف الحالة عند `COMPLETED`/`CANCELLED` (يمنع تسرّب الذاكرة) | `trips.service.ts` | ✅ |
| 5.17 | حدث `ROUTE_DEVIATION` + تنبيه WARNING + إشعار للراكب | — | ✅ |
| 5.18 | مفاتيح بيئة للضبط والإيقاف | `.env.example` | ✅ |

### لماذا تنبيه وليس إيقاف رحلة؟

المنعطف لتجنّب ازدحام أو طريق مغلق مشروع تمامًا. الإيقاف التلقائي ينتج إنذارات كاذبة
ويُفقد الثقة؛ لذلك النتيجة إعلام الراكب وفريق المراقبة فقط، مع تسجيل دائم في `TripEvent`
يصلح دليلًا عند الشكاوى.

## المرحلة 5 — الجزء الرابع: إخفاء أرقام الهواتف ✅

### العيب

رقم هاتف الراكب كان يُرسل **خامًا** إلى تطبيق السائق (والعكس) في تفاصيل الرحلة
وفي سجلّ الرحلات. عمليًا: السائق يحتفظ برقم كل راكب نقله ويمكنه الاتصال بعد أسابيع.
وهذه أكثر شكاوى الأمان تكرارًا في تطبيقات النقل.

| # | البند | الملف | الحالة |
|---|------|------|-------|
| 5.19 | واجهة `CallMaskingAdapter` مجرّدة (نفس نمط `PaymentAdapter`) + دالة `maskPhone` النقية | `calls/call-masking.adapter.ts` | ✅ |
| 5.20 | محوّل `chat_only` يعمل اليوم (حجب كامل + دردشة الرحلة الموجودة) | نفس الملف | ✅ |
| 5.21 | محوّل Twilio يرمي خطأً صريحًا حتّى يُنفّذ — لا رقم وهمي ولا طمأنينة كاذبة | نفس الملف | ✅ |
| 5.22 | `CallMaskingService`: تحقّق ملكية + حالة رحلة قائمة + تسجيل `CALL_REQUESTED` | `calls/call-masking.service.ts` | ✅ |
| 5.23 | حجب الأرقام فعليًا في تفاصيل الرحلة وسجلّ الرحلات وواجهة السائق | `matching.service.ts`, `driver-self.service.ts` | ✅ |
| 5.24 | مسارات `GET /api/calls/mode` و`POST /api/calls/connect` | `calls/call-masking.controller.ts` | ✅ |

### ملاحظة إدارية

واجهات الموظّفين (الدعم/الإدارة) لم تُمسّ: الأرقام تبقى ظاهرة لهم لأنّ الدعم يحتاج
الاتصال فعليًا عند الحوادث، وهذه المسارات محمية بـ `RolesGuard` و`PermissionsGuard`.

### لتفعيل الأرقام الوسيطة لاحقًا

شراء أرقام من المزوّد، ثم تنفيذ `TwilioCallMaskingAdapter.connect` + Webhook للتحويل،
ثم `CALL_MASKING_PROVIDER=twilio`. لا حاجة للمساس بمنطق الرحلات أو التطبيق.

## المرحلة 5 — الجزء الخامس: المفقودات (Lost & Found)

الخلل: لا يوجد أي أثر للمفقودات في المشروع كلّه (لا نموذج، لا مسار، لا إشعار)،
مع أنّ كل التطبيقات العالمية تعتبره ميزة أساسية بعد انتهاء الرحلة.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 5.25 | `enum LostItemStatus` + `model LostItem` مع علاقات `User`/`Trip` | `prisma/schema.prisma` | ✅ |
| 5.26 | مايغريشن مطابق تمامًا للسكيما (جدول + فهارس + مفاتيح أجنبية) | `prisma/migrations/20260727053000_lost_items/migration.sql` | ✅ |
| 5.27 | خدمة المفقودات: تحقق ملكية الرحلة + حالة `COMPLETED` + نافذة 30 يومًا | `src/modules/lost-items/lost-items.service.ts` | ✅ |
| 5.28 | إشعار السائق فورًا + تحويل الحالة إلى `DRIVER_NOTIFIED` + تنبيه `support.lost_item` | `lost-items.service.ts` | ✅ |
| 5.29 | السائق يرى البلاغ لكن رقم التواصل يمرّ عبر `maskPhone` | `lost-items.service.ts` → `forDriver()` | ✅ |
| 5.30 | مسارات: `POST /api/lost-items`، `GET me`، `GET driver`، ومسارات موظّفين محمية بـ `support.manage` | `lost-items.controller.ts` | ✅ |
| 5.31 | تسجيل الوحدة في التطبيق | `src/app.module.ts` | ✅ |

### لماذا جدول مستقل وليس تذكرة دعم؟

دورة حياة المفقود مختلفة تمامًا عن الشكوى:
`OPEN → DRIVER_NOTIFIED → FOUND → RETURNED` (أو `NOT_FOUND`/`CLOSED`)، وهي مرتبطة برحلة وسائق محدّدين،
وتحتاج قياس مؤشّر "نسبة استرجاع الأغراض" منفصلًا عن مؤشّرات الدعم.

## المرحلة 5 — الجزء السادس: فواتير PDF للرحلات

الخلل: `grep -rn "invoice" prisma/schema.prisma` لم يُرجع شيئًا؛ لا يوجد نموذج فاتورة ولا مسار تنزيل،
مع أنّ `pdfkit` مثبّت ومولّد PDF جاهز يُستعمل في تقارير الموظّفين فقط.
الراكب الذي يحتاج إثبات مصروف لشركته لم يكن يجد أي وثيقة.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 5.32 | `model Invoice` + `model InvoiceSequence` + `enum InvoiceStatus` | `prisma/schema.prisma` | ✅ |
| 5.33 | مايغريشن مطابق (جدولان + فهارس فريدة + مفاتيح أجنبية) | `prisma/migrations/20260727060000_invoices/migration.sql` | ✅ |
| 5.34 | ترقيم تسلسلي شهري `FG-202607-000123` — دوال نقيّة | `src/modules/invoices/invoice-number.util.ts` | ✅ |
| 5.35 | عدّاد ذري `INSERT ... ON CONFLICT DO UPDATE RETURNING` — لا تكرار ولا فجوات تحت التزامن | `invoices.service.ts` → `nextSequence()` | ✅ |
| 5.36 | لقطة (snapshot) مجمّدة: تغيّر التسعيرة لاحقًا لا يغيّر فاتورة صدرت | `invoices.service.ts` → `issueForTrip()` | ✅ |
| 5.37 | توليد PDF حقيقي بإعادة استخدام `buildPdf` + رفع اختياري إلى GCS | `invoices.service.ts` → `pdf()` | ✅ |
| 5.38 | مسارات: `GET /api/invoices/me`، `POST /api/invoices/trip/:tripId`، `GET /api/invoices/:id/pdf` | `invoices.controller.ts` | ✅ |
| 5.39 | تسجيل الوحدة | `src/app.module.ts` | ✅ |

### ملاحظة مهمة: الخط العربي

مولّد الـ PDF يستخدم `assets/fonts/NotoNaskhArabic-Regular.ttf` إن وُجد، وإلا يسقط إلى Helvetica
التي لا تدعم العربية. **ضع ملف الخط في ذلك المسار قبل الإنتاج** وإلا ستظهر الفواتير
بمربعات بدل الحروف. لم أُنزّل الخط لأنّ البيئة بلا إنترنت.

### لماذا الإصدار عند الطلب وليس تلقائيًا مع كل رحلة؟

إصدار فاتورة لكل رحلة يستهلك أرقامًا تسلسلية لمستندات لن يطلبها أحد، ويثقل مسار التسوية.
`issueForTrip` خامل التكرار (idempotent) ومُصدّر من الوحدة، فيمكن استدعاؤه لاحقًا
من `settleCompletedTrip` إن أردت الإصدار التلقائي دون تعديل الخدمة.

## المرحلة 5 — الجزء السابع: تقسيم جدول التتبّع وسياسة الاحتفاظ

الخلل: `TripTracking` جدول عادي بلا أي سياسة حذف (`grep deleteMany` في وحدة الرحلات ← لا شيء)،
مع أنّه يستقبل نقطة GPS كل بضع ثوانٍ لكل رحلة نشطة. عند 1000 رحلة يوميًا
يتجاوز الجدول 100 مليون صف خلال سنة، فينتفخ الفهرس ويبطؤ كل استعلام تتبّع،
ويصبح `VACUUM` والنسخ الاحتياطي عبئًا ثقيلًا.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 5.40 | مفتاح أساسي مركّب `@@id([id, recordedAt])` لأنّ مفتاح التقسيم يجب أن يكون جزءًا منه | `prisma/schema.prisma` | ✅ |
| 5.41 | تحويل الجدول إلى `PARTITION BY RANGE ("recordedAt")` دون فقدان صف واحد | `prisma/migrations/20260727065000_trip_tracking_partitions/migration.sql` | ✅ |
| 5.42 | قسم افتراضي `TripTracking_default` يلتقط أي تاريخ بلا قسم — لا يفشل إدراج أبدًا | نفس المايغريشن | ✅ |
| 5.43 | دالة `flamingo_ensure_tracking_partition(date)` خاملة التكرار | نفس المايغريشن | ✅ |
| 5.44 | دوال نقيّة للأسماء والمدّة مع تعبير نمطي صارم | `src/modules/trips/tracking-retention.util.ts` | ✅ |
| 5.45 | مهمة يومية 03:20 تحت قفل `cron:tracking-partitions`: إنشاء مسبق + حذف منتهٍ | `src/modules/trips/tracking-retention.service.ts` | ✅ |
| 5.46 | 7 اختبارات وحدة للدوال النقيّة (منها حالة حقن SQL) | `tracking-retention.util.spec.ts` | ✅ |
| 5.47 | تسجيل الخدمة في وحدة الرحلات + `TRIP_TRACKING_RETENTION_MONTHS` | `trips.module.ts` ، `.env.example` | ✅ |

### لماذا DROP PARTITION وليس DELETE؟

`DELETE FROM "TripTracking" WHERE "recordedAt" < ...` على عشرات الملايين يستغرق دقائق، يقفل الصفوف،
يملأ WAL، ويترك مساحة ميتة لا يستردها إلا `VACUUM FULL` (الذي يقفل الجدول كليًا).
أمّا `DROP TABLE "TripTracking_202601"` فعملية وصفية فورية تحرّر المساحة فورًا.
وز\يادةً على ذلك، استعلام مسار رحلة من الأمس يمسّ قسم شهر واحد بدل الجدول كلّه (partition pruning).

### خطوات تشغيل إلزامية

1. المايغريشن ينسخ البيانات ثم يحذف الجدول القديم — **خذ نسخة احتياطية قبل تشغيله** ونفّذه في نافذة صيانة.
2. يتطلّب PostgreSQL 12+ (مفاتيح أجنبية من جدول مُقسّم).
3. المهمة تعمل في نسخة الـ worker فقط (`APP_ROLE=worker`) كبقية المهام المجدولة.

## المرحلة 6 — الجزء الأول: ذاكرة تخزين موزّعة للإعدادات ومفاتيح الميزات

الخلل: `publicConfig()` كان يخزّن في متغيّر داخل العملية لمدة 15 ثانية فقط، و`evaluate()`
لمفاتيح الميزات لم يكن مخزّنًا إطلاقًا — مع أنّ كليهما يُستدعى في **كل إقلاع تطبيق** عبر `bootstrap`.
أسوأ من ذلك: الذاكرة داخل العملية تعني أنّ تعديلًا من لوحة التحكم يظهر في نسخة واحدة
فورًا ويتأخّر في بقية النسخ — فيرى مستخدمون تسعيرًا أو ميزة مختلفة عن آخرين في اللحظة نفسها.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 6.1 | ذاكرة ذات طبقتين: محلية 5 ثوانٍ + Redis مشتركة | `src/common/infra/config-cache.service.ts` | ✅ |
| 6.2 | إلغاء صلاحية عبر Redis Pub/Sub يمسح الطبقة المحلية في كل النسخ | نفس الملف | ✅ |
| 6.3 | حذف المفاتيح بـ `SCAN` وليس `KEYS` (الأخير يحجب Redis) | نفس الملف | ✅ |
| 6.4 | بصمة سياق ثابتة لا تتأثر بترتيب المفاتيح | `config-cache.util.ts` | ✅ |
| 6.5 | `publicConfig()` مخزّن 60 ثانية مع إلغاء فوري في `afterMutation` | `settings.service.ts` | ✅ |
| 6.6 | `evaluate()` مخزّن 30 ثانية حسب السياق + إلغاء في الأربع طفرات المعدّلة | `feature-flags.service.ts` | ✅ |
| 6.7 | تسجيل الخدمة في `InfraModule` العامة | `infra.module.ts` | ✅ |
| 6.8 | 7 اختبارات وحدة للدوال النقيّة | `config-cache.util.spec.ts` | ✅ |

### ملاحظات تصميمية

- **لماذا طبقتان؟** طلب Redis يكلف ذهابًا وإيابًا عبر الشبكة؛ الطبقة المحلية تمتص رشقات الإقلاع المتزامنة بلا أي طلب خارجي.
- **لماذا مشترك منفصل؟** عميل Redis في وضع `subscribe` لا يقبل أوامر أخرى، لذلك يُستخدم `duplicate()`.
- **فشل آمن:** أي خطأ في الذاكرة يُسجّل فقط ويُسقط الطلب إلى قاعدة البيانات — انقطاع Redis لا يوقف الخدمة.

## المرحلة 6 — الجزء الثاني: إصدار الفاتورة تلقائيًا عند اكتمال الرحلة

الخلل: بعد الجزء السادس من المرحلة 5 صارت الفواتير موجودة، لكنّها لا تُنشأ إلا إذا طلبها
الراكب صراحةً. في التطبيقات العالمية الفاتورة تصدر مع التسوية نفسها، لأنّ الترقيم المحاسبي
يجب أن يتبع ترتيب وقوع الرحلات لا ترتيب فضول المستخدمين.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 6.9 | ربط `InvoicesModule` بـ `TripsModule` (لا تبعية دائرية: وحدة الفواتير تستورد Prisma فقط) | `trips.module.ts` | ✅ |
| 6.10 | `settleCompletedTrip` يستدعي إصدار الفاتورة بعد نجاح التسوية | `trips.service.ts` | ✅ |
| 6.11 | `issueInvoiceQuietly`: فشل الفاتورة لا يُرجع تسوية مالية ناجحة | `trips.service.ts` | ✅ |
| 6.12 | الاعتماد على خمول التكرار في `issueForTrip` كشبكة أمان للطلب اليدوي لاحقًا | `invoices.service.ts` | ✅ |

### لماذا أفضل جهد وليس معاملة واحدة؟

إقحام إنشاء الفاتورة داخل معاملة التسوية يعني أنّ عطلًا في التخزين أو في عدّاد الترقيم
سيُرجع توزيع أرباح السائق وعمولة المنصّة — أي أنّ مستندًا ورقيًا يعطّل حركة مال حقيقية.
الترتيب الصحيح: المال أولًا، ثمّ المستند، مع إمكانية إعادة إصدار المستند لاحقًا دون ازدواج.

## المرحلة 6 — الجزء الثالث: إكراميات السائقين

الخلل: `grep -rin "tip" src` لم يرجع شيئًا. لا جدول، ولا مسار، ولا قيد محاسبي.
الإكرامية موجودة في Uber وBolt وHeetch وياسير، وهي من أقوى أدوات رفع دخل السائق
دون أي تكلفة على المنصّة.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 6.13 | `model TripTip` + `enum TripTipStatus` مع `tripId` فريد (إكرامية واحدة لكل رحلة) | `prisma/schema.prisma` | ✅ |
| 6.14 | مايغريشن الجدول والفهارس والمفاتيح الأجنبية | `prisma/migrations/20260727070000_trip_tips/` | ✅ |
| 6.15 | `transferTip`: قيد مزدوج متوازن من محفظة الراكب إلى محفظة السائق | `financial.service.ts` | ✅ |
| 6.16 | رفض الرصيد غير الكافي + منع إكرام النفس + خمول التكرار | `financial.service.ts` | ✅ |
| 6.17 | حركة المال وإنشاء السجل في معاملة واحدة | `tips.service.ts` | ✅ |
| 6.18 | نافذة 72 ساعة + حدود 20..5000 + مبالغ مقترحة | `tips.util.ts` | ✅ |
| 6.19 | 4 مسارات: `options` ، `POST trip/:tripId` ، `sent` ، `received` (مع المجموع) | `tips.controller.ts` | ✅ |
| 6.20 | إشعار السائق (أفضل جهد) + تسجيل الوحدة في `AppModule` | `tips.module.ts` ، `app.module.ts` | ✅ |
| 6.21 | 5 اختبارات وحدة للدوال النقيّة | `tips.util.spec.ts` | ✅ |

### قرارات محاسبية

- **بلا عمولة إطلاقًا:** الإكرامية تصل السائق كاملة؛ أخذ عمولة منها مرفوض في كل المنصّات الجادة.
- **من المحفظة فقط حاليًا:** مطابق لقرار الدفع (نقدًا + محفظة). عند تفعيل البطاقات يُضاف محوّل الدفع كمصدر تمويل بديل دون تغيير القيد.
- **لماذا معاملة واحدة هنا وأفضل جهد في الفاتورة؟** لأنّ سجل الإكرامية هو الدليل الوحيد على حركة مال حدثت، أمّا الفاتورة فمستند قابل لإعادة التوليد.

## المرحلة 6 — الجزء الرابع: توصيل الولاء والإحالات بالرحلات

الخلل (من نوع `surge.util.ts` نفسه): الوحدتان مكتوبتان بالكامل وغير موصولتين:

```
grep -rn "LoyaltyService"  src | grep -v loyalty/   →  لا شيء
grep -rn "ReferralService" src | grep -v referral/  →  لا شيء
```

`earnFromTrip` و`qualifyReferral` كانتا كودًا ميتًا حرفيًا؛ التعليق فوقهما يقول "نقطة تكامل مستقبلية".
النتيجة: راكب يرى رصيد نقاط صفرًا إلى الأبد، ومُحيل لا يقبض مكافأته مهما دعا أصدقاءه.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 6.22 | `grantTripRewardsQuietly` تُستدعى بعد كل تسوية رحلة | `trips.service.ts` | ✅ |
| 6.23 | منح نقاط الولاء حسب قيمة الرحلة (`loyalty:earn:trip:{id}`) | `loyalty.service.ts` | ✅ |
| 6.24 | تأهيل الإحالة ومنح الطرفين رصيدًا ترويجيًا | `referral.service.ts` | ✅ |
| 6.25 | `TripsModule` يستورد `LoyaltyModule` و`ReferralModule` (بلا دائرية) | `trips.module.ts` | ✅ |
| 6.26 | توثيق 13 متغير بيئة للولاء والإحالات | `.env.example` | ✅ |

### لماذا أفضل جهد وخارج معاملة التسوية؟

النقاط والمكافآت ترويجية، وفشلها لا يجوز أن يُرجِع تسوية مالية حقيقية نجحت.
ولأنّ كلا الدالتين خاملتا التكرار، يمكن إعادة تشغيلهما لاحقًا من اللوحة دون ازدواج.

## المرحلة 6 — الجزء الخامس: سكة صرف أرباح السائقين

الخلل: `grep -rn "PayoutBatchService" src | grep -v payouts/` → **لا شيء**.
وحدة دفعات الصرف كاملة (جدولان، آلة حالات، تحقق IBAN، مراجع حتمية) ومعزولة عن طلبات السحب وعن دفتر القيود.
الأثر: مال السائق يبقى محجوزًا في `LOCKED` حتّى يضغط موظف "مدفوع" يدويًا لكل طلب على حدة، ولا رابط بين ما أُرسل للبنك وما سُوّي في النطام.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 6.27 | حقول التحويل البنكي: `payoutIban` ، `payoutBankName` ، `payoutAccountHolder` | `prisma/schema.prisma` | ✅ |
| 6.28 | مايغريشن إضافية آمنة (`ADD COLUMN IF NOT EXISTS`) | `20260727160000_driver_payout_bank/` | ✅ |
| 6.29 | `queue()`: طلبات معتمدة غير مدرجة في أي دفعة نشطة | `payout-bridge.service.ts` | ✅ |
| 6.30 | `draftFromWithdrawals()`: دفعة من طلبات سحب معتمدة + رفض الازدواج | `payout-bridge.service.ts` | ✅ |
| 6.31 | `settleBatch()`: يصرف كل طلب عبر `markPaid` → `completeWithdrawal` | `payout-bridge.service.ts` | ✅ |
| 6.32 | الفشل الجزئي يُسجّل على `PayoutItem.failureReason` ويبقى قابلًا للمراجعة | `payout-bridge.service.ts` | ✅ |
| 6.33 | 4 مسارات موظفين جديدة + مسارا السائق لبيانات بنكه | `payouts.controller.ts` | ✅ |
| 6.34 | `PayoutsModule` يستورد `PaymentsModule` (بلا دائرية) | `payouts.module.ts` | ✅ |

### المسار المالي المكتمل الآن

```
طلب سحب (PENDING)  → reserveWithdrawal   → AVAILABLE → LOCKED
اعتماد (APPROVED)
دفعة صرف (DRAFT)     → ملف/مزوّد البنك
إتمام (PAID)         → completeWithdrawal  → LOCKED → خروج نقدي
```

### قرارات

- **السحوبات تُسوّى قبل نقل الدفعة إلى PAID:** دفتر القيود هو الحقيقة المالية، وحالة الدفعة غلاف تشغيلي.
- **لا معاملة واحدة تلفّ الدفعة كلها:** 200 سائق في معاملة واحدة = قفل طويل وفشل جماعي بسبب سائق واحد. الصرف لكل عنصر مستقل، و`markPaid` يرفض التكرار بآلة الحالات.
- **`manual` لا يشترط IBAN:** الصرف اليدوي/النقدي واقع في الجزائر؛ أمّا مزوّد بنكي فيُرفض بلا IBAN صالح.

## المرحلة 7 — الجزء الأول: إخفاء الأرقام الحقيقي (Twilio Voice)

في المرحلة 5 بُنيت الطبقة المجرّدة ومحوّل "دردشة فقط"، وكان محوّل Twilio
يرمي `not implemented` بوضوح. الآن أُنجز بالكامل.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 7.1 | `model CallSession`: ربط (رقم وسيط + متصل) → وجهة | `prisma/schema.prisma` | ✅ |
| 7.2 | مايغريشن `20260727163000_call_sessions` | `prisma/migrations/` | ✅ |
| 7.3 | `ProxyNumberAllocator`: فصل التخزين عن المحوّل النقي | `call-masking.adapter.ts` | ✅ |
| 7.4 | `verifyTwilioSignature`: HMAC-SHA1 على (الرابط + الحقول مرتّبة) + `timingSafeEqual` | `call-masking.adapter.ts` | ✅ |
| 7.5 | `buildDialTwiml` / `buildRejectTwiml` / `escapeXml` | `call-masking.adapter.ts` | ✅ |
| 7.6 | `TwilioCallMaskingAdapter.connect` حقيقي (حجز رقم وإرجاعه) | `call-masking.adapter.ts` | ✅ |
| 7.7 | `allocate`: إعادة استخدام جلسة الرحلة + منع الالتباس | `call-masking.service.ts` | ✅ |
| 7.8 | `resolveInbound`: تحويل + عدّ المكالمات + `CALL_CONNECTED` | `call-masking.service.ts` | ✅ |
| 7.9 | `revokeForTrip`: إبطال فوري عند الإساءة | `call-masking.service.ts` | ✅ |
| 7.10 | `POST /api/calls/twilio/voice` عام محمي بالتوقيع فقط | `twilio-voice.controller.ts` | ✅ |
| 7.11 | 12 اختبار وحدة للدوال النقية | `call-masking.adapter.spec.ts` | ✅ |

### كيف تجري المكالمة فعليًا

```
1) الراكب يضغط "اتصال" → POST /api/calls/connect
2) الخادم يحجز رقمًا وسيطًا → يُرجع proxyNumber فقط
3) الراكب يتصل بالرقم الوسيط من رقمه المسجل
4) Twilio يطرق /api/calls/twilio/voice بـ (To=الوسيط، From=الراكب)
5) الخادم يردّ <Dial callerId="الوسيط">رقم السائق</Dial>
6) السائق يرى رقم المنصة لا رقم الراكب
```

### قرارات

- **لا نستخدم Twilio Proxy API:** أُوقف للحسابات الجديدة؛ نمط (رقم + متصل → وجهة) يعمل على أي حساب Voice عادي ولا يربطنا بمنتج واحد.
- **لا اتصال شبكي وقت الطلب:** الحجز داخلي فقط، فلا يتأخر زر "اتصال" ولا يفشل لانقطاع API خارجي.
- **الثنائية (رقم وسيط + رقم متصل) تجب أن تكون فريدة:** لو تكررت، لوصلت المكالمة لشخص خاطئ — فإن لم يتوفر رقم أمين نرفض بـ `NO_PROXY_NUMBER_AVAILABLE` ولا نخاطر.
- **رفض غامض للمتصل:** رسالة واحدة لا تفرّق بين "رقم غير مسجل" و"ربط منتهٍ"، لمنع استخدام الرقم الوسيط للتجسس.
- **التسجيل مُعطّل افتراضيًا:** تسجيل المكالمات يلزمه موافقة صريحة وإشعار قانوني؛ `TWILIO_RECORD_CALLS=false`.

## المرحلة 7 — الجزء الثاني: الوضع المباشر (الرقم الحقيقي الآن)

قرار تشغيلي: الأرقام الوسيطة تكلف مالًا وحسابًا جاهزًا، وفي الإقلاع
المبكر الأولوية أن يصل السائق للراكب. لذلك أُضيف محوّل ثالث داخل **نفس**
الطبقة المجرّدة، فلا يتغير منطق الرحلات ولا مسارات API عند الترقية لاحقًا.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 7.12 | `CallMaskingProvider` أصبح `chat_only \| direct \| twilio` | `call-masking.adapter.ts` | ✅ |
| 7.13 | وضع ثالث `DIRECT_NUMBER` + حقل `phoneNumber` | `call-masking.adapter.ts` | ✅ |
| 7.14 | `DirectCallMaskingAdapter` مع سياسة كشف لكل دور | `call-masking.adapter.ts` | ✅ |
| 7.15 | `parseDirectCallRoles`: both / passenger / driver / none | `call-masking.adapter.ts` | ✅ |
| 7.16 | تسجيل المحوّل وقراءة `DIRECT_CALL_REVEAL` | `call-masking.service.ts` | ✅ |
| 7.17 | `GET /api/calls/mode` يُرجع الأوضاع الثلاثة | `call-masking.controller.ts` | ✅ |
| 7.18 | إعادة إنشاء الخدمة بعد فشل كتابة صامت (allocate/resolveInbound) | `call-masking.service.ts` | ✅ |

### مقارنة الأوضاع الثلاثة

| الوضع | التكلفة | الخصوصية | متى |
| --- | --- | --- | --- |
| `chat_only` | صفر | كاملة | لا مكالمات أصلًا |
| `direct` | صفر | معدومة (الرقم مكشوف) | الإقلاع الأول |
| `twilio` | رقم شهري + دقائق | كاملة | عند النمو |

### إضافة Vonage لاحقًا — ما يلزم فعلًا

1. ملف واحد: `class VonageCallMaskingAdapter implements CallMaskingAdapter`، يعيد استخدام `ProxyNumberAllocator` و`CallSession` كما هي.
2. مسار webhook واحد يُرجع NCCO (JSON) بدل TwiML (XML)، مع تحقق JWT من Vonage بدل HMAC-SHA1.
3. سطر `register(...)` في الخدمة + قيمة بيئة جديدة.

لا يُلمس: منطق الرحلات، الأذونات، التطبيقات المحمولة (تقرأ `mode` فقط).

## المرحلة 7 — الجزء الثالث: محوّل الدفع بالبطاقة Chargily (حقيقي)

| # | العمل | الملف | الأثر |
| --- | --- | --- | --- |
| 7.19 | حذف محوّل Chargily الوهمي (كان يرمي `not implemented`) | `providers/payment-adapter.ts` | لا كود ميت |
| 7.20 | محوّل حقيقي على Chargily Pay v2 بـ `fetch` بلا SDK | `providers/chargily.adapter.ts` | دفع بالبطاقة حقيقي |
| 7.21 | `createCheckout` يرجع `checkoutUrl` + `metadata.paymentId` | نفسه | ربط webhook بالدفعة الداخلية |
| 7.22 | `capture` يقرأ الحالة من المزوّد ويرفض ما ليس `paid` | نفسه | لا تحصيل وهمي في الدفتر |
| 7.23 | `refund` يرمي `CHARGILY_REFUND_NOT_SUPPORTED` صراحةً | نفسه | الاسترداد عبر المحفظة فقط |
| 7.24 | تحقق توقيع webhook بـ HMAC-SHA256 على البايتات الخام من ترويسة `signature` | `payment-webhooks.controller.ts` | لا يُقبل حدث منتحل |
| 7.25 | تسجيل المحوّل شرطيًا + `CARD → chargily` عند التوفر | `payment-provider.service.ts` | تفعيل بمتغير بيئة واحد |
| 7.26 | تحويل `checkout.paid/failed/expired` إلى `PaymentStatus` | نفسه | حالات دفع متسقة |
| 7.27 | 14 اختبارًا (إعداد، توقيع بمتجه HMAC حقيقي، حالات، حواجز) | `chargily.adapter.spec.ts` | تغطية المسار المالي |

### تدفّق الدفع بالبطاقة

```
الراكب يختار البطاقة
   ↓
PaymentsService → PaymentProviderService.createCheckout(method=CARD)
   ↓  (chargily مسجّل؟)
POST {base}/checkouts   →  { id, checkout_url, status: pending }
   ↓
التطبيق يفتح checkout_url  →  الراكب يدفع لدى البنك
   ↓
Chargily → POST /api/payments/webhooks/chargily  (header: signature)
   ↓  تحقق HMAC-SHA256 على rawBody
processWebhook → checkout.paid → CAPTURED → تسوية الرحلة في الدفتر
```

### قرارات

- **بلا SDK:** `fetch` + `node:crypto` فقط؛ لا تبعية جديدة في `package.json`، ومهلة 15 ثانية مع `AbortController` حتى لا يتعلق طلب الراكب.
- **DZD فقط:** أي عملة أخرى تُرفض قبل أي نداء شبكي.
- **لا استرداد وهمي:** Chargily لا توفر endpoint للاسترداد، وإرجاع نجاح كان سيخلق اختلالًا لا يُكتشف إلا عند التسوية مع البنك؛ البديل المعتمد: رصيد محفظة.
- **توقيع منفصل:** Chargily توقّع بمفتاحها السرّي في ترويسة `signature`، لا بـ `PAYMENT_WEBHOOK_SECRET`، لذلك لها فرع خاص؛ باقي المزوّدين لم يتأثروا.
- **تفعيل شرطي:** بلا `CHARGILY_SECRET_KEY` يبقى النطاق نقدًا + محفظة كما هو، ولا يفشل الإقلاع.

### خطوات التفعيل لاحقًا

1. افتح حساب Chargily وخذ المفتاح السرّي (test أولًا).
2. `CHARGILY_SECRET_KEY=...` و`CHARGILY_MODE=test`، و`CHARGILY_WEBHOOK_URL={BASE}/api/payments/webhooks/chargily`.
3. اختبر رحلة ببطاقة تجريبية، وتأكد أن الحدث وصل وأن الدفتر متوازن في `reconciliationSummary`.
4. بعد النجاح: `CHARGILY_MODE=live` ومفتاح الإنتاج — لا تعديل كود.

## المرحلة 7 — الجزء الرابع: مزوّد البريد وقوالب موحّدة

| # | العمل | الملف | الأثر |
| --- | --- | --- | --- |
| 7.28 | طبقة قوالب نقية (6 قوالب × ar/fr/en) | `providers/email-templates.ts` | رسالة واحدة متسقة لا نسخ متفرقة |
| 7.29 | تخطيط HTML موحّد: جدول 600px، أنماط سطرية، `dir=rtl` للعربية | نفسه | يعمل في Gmail/Outlook |
| 7.30 | هروب HTML لكل متغير من بيانات المستخدم | نفسه | لا حقن HTML عبر الاسم |
| 7.31 | متغير إلزامي ناقص ← `EMAIL_TEMPLATE_VAR_MISSING_*` | نفسه | لا تُرسل رسالة فيها فراغ |
| 7.32 | دعم Resend وSendGrid وأي API عام بمتغير واحد | `providers/email.provider.ts` | تبديل مزوّد بلا تعديل كود |
| 7.33 | مهلة `EMAIL_TIMEOUT_MS` بـ `AbortController` | نفسه | مزوّد بطيء لا يجمّد طلبًا |
| 7.34 | رسالة لكل مستلم + لا تسجيل للعناوين في اللوغ | نفسه | خصوصية |
| 7.35 | الموزّع يجمّع المستلمين بحسب `User.locale` | `notification-dispatcher.service.ts` | كل مستخدم بلغته واتجاهه |
| 7.36 | 20 اختبارًا للقوالب وبناء الطلب | `email-templates.spec.ts`، `email.provider.spec.ts` | تغطية |

### القوالب المتاحة

| المعرّف | الاستخدام | المتغيرات الإلزامية |
| --- | --- | --- |
| `generic_notice` | أي إشعار عام (يستخدمه الموزّع الآن) | `title`، `body` |
| `welcome` | بعد إنشاء الحساب | `name` |
| `trip_receipt` | إيصال بعد الرحلة | `name`، `tripId`، `amount`، `currency`، `date` |
| `invoice_ready` | فاتورة PDF جاهزة (زر تحميل) | `name`، `invoiceNumber`، `amount`، `currency` |
| `payout_settled` | تحويل أرباح السائق | `name`، `amount`، `currency`، `reference` |
| `lost_item_update` | تحديث مفقودات | `name`، `itemTitle`، `status` |

### قرارات

- **قوالب كدوال خالصة لا صفوف قاعدة بيانات:** مراجعة بـ git، اختبار بلا شبكة، ولا خطر إرسال قالب ناقص بعد تعديل يدوي في لوحة. ملاحقة: `model LegalDocument` لا يزال للوثائق القانونية، لا للبريد.
- **أنماط سطرية فقط:** Gmail يحذف `<style>` في حالات كثيرة، و`flex`/`grid` غير مدعومين في Outlook؛ لذلك جداول.
- **لا تغيير في الواجهة القديمة:** `send({emails, subject, body})` ما زالت تعمل؛ أُضيفت حقول اختيارية فقط (`text`، `locale`، `prerendered`).

## المرحلة 7 — الجزء الخامس: أرشفة جدول الرحلات

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 7.37 | دوال نقيّة لقرار الأرشفة وبناء النسخة الباردة | `src/modules/trips/trip-archive.util.ts` | ✅ |
| 7.38 | جدول `TripArchive` + عمود `Trip.archivedAt` وفهرسه | `prisma/schema.prisma` | ✅ |
| 7.39 | مايغريشن الأرشيف (خامل التكرار بالكامل) | `prisma/migrations/20260727173000_trip_archive/` | ✅ |
| 7.40 | خدمة الأرشفة على دفعات داخل معاملة واحدة لكل رحلة | `src/modules/trips/trip-archive.service.ts` | ✅ |
| 7.41 | مهمة مجدولة 03:50 مع قفل موزّع `cron:trip-archive` | `trip-archive.service.ts` | ✅ |
| 7.42 | مسارات موظّفين: مقاييس ، تشغيل تجريبي/فعلي ، قراءة نسخة | `src/modules/trips/trip-archive.controller.ts` | ✅ |
| 7.43 | ربط الخدمة والتحكم في الوحدة | `src/modules/trips/trips.module.ts` | ✅ |
| 7.44 | متغيرات البيئة الثلاثة (معطّلة افتراضيًا) | `.env.example` | ✅ |
| 7.45 | 19 اختبارًا للدوال النقيّة | `trip-archive.util.spec.ts` | ✅ |

### قرارات تصميمية

- **لا نحذف صف `Trip`.** `Payment` و `Invoice` و `DriverEarning` و `CompanyEarning`
  تشير إليه؛ حذفه يكسر الدفتر المالي. المحذوف هو الأبناء الثقيلون
  فقط: `TripEvent` و `TripMessage`، بعد حفظ نسخة منهما في `snapshot`.
- **الترتيب داخل المعاملة:** كتابة النسخة أولًا ثم الحذف ثم وسم `archivedAt`؛
  أي فشل يرجع بالكل ولا يترك رحلة بلا أحداث وبلا نسخة.
- **حواجز الأمان:** حالة نهائية فقط، تسوية مستقرّة فقط، لا مفقودات ولا
  شكاوى مرتبطة، وحدّ أدنى 3 أشهر للعمر حتى لو ضُبطت البيئة بقيمة أقل.
- **معطّلة افتراضيًا** (`TRIP_ARCHIVE_ENABLED=false`): مهمة تحذف بيانات لا تُفعّل
  من تلقاء نفسها بعد التحديث.
- **`snapshotVersion`** محفوظ مع كل صف حتى يمكن ترقية شكل النسخة لاحقًا
  دون تخمين.

### وصفة التشغيل

1. `npx prisma migrate deploy` لإنشاء `TripArchive`.
2. `GET /api/trips/archive/stats` — كم رحلة مرشّحة؟
3. `POST /api/trips/archive/run` بـ `{"dryRun": true}` — تأكيد دون حذف.
4. `POST /api/trips/archive/run` بـ `{"limit": 200}` — دفعة حقيقية.
5. بعد الارتياح: `TRIP_ARCHIVE_ENABLED=true` لتعمل يوميًا وحدها.

## المرحلة 7 — الجزء السادس: توصيل البريد المعاملاتي بأحداث حقيقية ✅

المشكلة: في الجزء الرابع بنينا ستة قوالب بريد مترجمة، لكن لا حدث واحد في النطاق الأعمالي كان يرسلها.

| # | البند | الملف | الحالة |
| --- | --- | --- | --- |
| 7.46 | دوال نقيّة للبريد المعاملاتي (تحقق العنوان، الاسم البديل، تنسيق المبلغ، تسميات المفقودات) | `src/modules/notifications/transactional-email.util.ts` | ✅ |
| 7.47 | خدمة إرسال لا ترمي أبدًا مع أسباب فشل مسمّاة | `transactional-email.service.ts` | ✅ |
| 7.48 | وحدة خفيفة تحمل Prisma فقط لتجنّب دورة التبعية | `transactional-email.module.ts` | ✅ |
| 7.49 | بريد `invoice_ready` عند إصدار الفاتورة فعليًا | `invoices/invoices.service.ts` | ✅ |
| 7.50 | بريد `trip_receipt` بعد تسوية الرحلة | `trips/trips.service.ts` | ✅ |
| 7.51 | بريد `payout_settled` لكل سائق دُفِع في الدفعة | `payouts/payout-bridge.service.ts` | ✅ |
| 7.52 | بريد `lost_item_update` بحالة مترجمة لا رمز داخلي | `lost-items/lost-items.service.ts` | ✅ |
| 7.53 | كل المناداة “أفضل جهد”: فشل البريد لا يُرجِع مالًا ولا يكسر طلبًا | الملفات الأربعة | ✅ |
| 7.54 | لا عنوان بريد في السجلات (template + locale + userId فقط) | `transactional-email.service.ts` | ✅ |
| 7.55 | 14 اختبارًا للدوال النقيّة | `transactional-email.util.spec.ts` | ✅ |

### قرارات هندسية

- **لماذا وحدة بريد منفصلة**: `NotificationsModule` يستورد Realtime و Auth، واستيراده من الفواتير يصنع دورة: Invoices → Notifications → Realtime → Trips → Invoices. الوحدة الخفيفة تقطع هذه الدورة دون `forwardRef`.
- **لماذا إيصال وفاتورة منفصلان**: الإيصال يُرسل دائمًا بعد التسوية، أمّا الفاتورة فمستند رسمي قد يفشل تخزين PDF له.
- **بريد الترحيب (`welcome`) مأجّل**: يحتاج توصيلًا في `AuthService`، ولا نلمس مسار التوثيق في نفس الدفعة لأنّ أي خطأ هنا يمنع الدخول.

