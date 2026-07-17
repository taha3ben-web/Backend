# P0 — تقوية النواة المالية (دفعة أولى)

هذه الدفعة تنفّذ الجزء الأعلى أولوية (P0) من خارطة الطريق: إغلاق النواة المالية وإزالة العملة المثبّتة وتقوية أمان الـ webhooks.

## التغييرات

### 1) إثراء دفتر الأستاذ (Ledger)
- `LedgerTransaction`: أُضيف `createdBy` (هوية المنفّذ، افتراضيًا `SYSTEM`) و`reason`.
- `LedgerEntry`: أُضيف `currency` و`role` و`balanceAfter` (لقطة الرصيد الجاري بعد كل قيد).
- `post()` الآن يحدّث الرصيد أولاً ثم يكتب القيد مع `balanceAfter`/`currency`/`role`.
- ملاحظة: `amount` يبقى على `LedgerEntry` (سلوك محاسبي سليم للقيد المزدوج) ولم يُنقل إلى المعاملة.

### 2) عدم تكرار السحب (Withdrawal Idempotency)
- `WithdrawRequest`: أُضيف `idempotencyKey String? @unique`.
- `CreateWithdrawDto`: حقل `idempotencyKey?` اختياري.
- `WithdrawalsService.createForDriver`: إن ورد نفس المفتاح يُعاد الطلب الموجود بدل إنشاء طلب/حجز مكرر.

### 3) إزالة العملة المثبّتة (Hardcoded DZD)
- أُضيف `DEFAULT_CURRENCY` في `src/common/money.util.ts` (يُقرأ من `process.env.DEFAULT_CURRENCY`، احتياطي `DZD`).
- أُزيلت كل العملات المثبّتة (18+ موضعًا) من:
  financial.service, wallet.service, driver-transfers.service, pricing-engine.service,
  pricing-admin.service, catalog-seed.service, vehicle-pricing.service, reports.service, statistics.service.

### 4) تحقّق توقيع الـ webhooks
- `payment-webhooks.controller`: تحقّق HMAC-SHA256 (ترويسة `x-webhook-signature` + سر `PAYMENT_WEBHOOK_SECRET`)
  بمقارنة زمنية آمنة (`timingSafeEqual`)، إضافةً إلى التوكن المشترك القائم.

### 5) اختبارات
- `src/common/ledger-balance.spec.ts`: اختبارات لتوازن القيد المزدوج وصحة العملة.
- دوال نقية مشتركة `isBalanced` و`isValidCurrency` في `money.util.ts`.

## الهجرة (Migration)
مجلد جديد: `prisma/migrations/20260713230000_p0_ledger_integrity/migration.sql` (إضافات أعمدة nullable فقط — آمنة على البيانات القائمة).

## خطوات التحقق في بيئتك
```bash
npm install
npx prisma generate
npx prisma migrate deploy      # أو npx prisma migrate dev في التطوير
npm run build
npm test
```
> ملاحظة: تم التحقق من صحة بنية كل الملفات المعدّلة (prettier/TypeScript parser). لم يُشغّل بناء كامل في البيئة المؤقتة بسبب تعذّر تثبيت التبعيات، لذا شغّل الأوامر أعلاه للتأكيد النهائي.

## متبقٍ من P0 (جولات قادمة)
- تحويل `DriverEarning`/`CompanyEarning`/`WalletTransaction`/`Wallet.balance` إلى projections مشتقّة من الـ Ledger.
- حالات تسوية صريحة على الرحلة (pending/posted/failed/retry) + حرّاس انتقال موحّدون.
- مهمة reconciliation دورية ترفع incident عند أي فرق.
- اختبارات تكامل/تزامن/استرداد.
- structured logs بـ traceId/actorId/ledgerTxId + تنبيهات.

---

## P0 — الجولة الثانية: مصدر الحقيقة الواحد

### 6) المصادر المالية الموازية ← projections مشتقّة من الـ Ledger
- **النتيجة بعد الفحص:** القاعدة أنضج ممّا يوحي التدقيق:
  - `WalletService` يقرأ الرصيد والحركات من الـ Ledger أصلاً (ليس من `Wallet.balance`).
  - `DriverEarning`/`CompanyEarning` تُكتب **داخل نفس معاملة الـ Ledger** (`Serializable`) فلا يمكن أن تتباين.
  - `Wallet` / `WalletTransaction` فعليًا مُهملة (لا قراءة ولا كتابة).
- **ما أُضيف في هذه الجولة:**
  - `deriveTripEarnings(lines)` — دالة نقية في `settlement.util.ts` تشتق gross/net/commission من قيود الـ Ledger.
  - `FinancialService.rebuildTripProjections(tripId)` و`rebuildAllTripProjections(limit)` — تعيد بناء جداول الأرباح من الـ Ledger (تُثبِت أنها مشتقّة وقابلة لإعادة البناء، وقابلة للتشغيل مرارًا بأمان).
  - `settleTrip` الآن يكتب قيم الأرباح عند `update` أيضًا (وليس `{}`) لتصحيح أي انحراف.
  - تعليقات `DEPRECATED` على `Wallet` و`WalletTransaction` في `schema.prisma` (دون إسقاط — يُؤجّل لهجرة لاحقة بعد تأكيد انعدام المستهلكين).
  - اختبارات وحدة: `derive-trip-earnings.spec.ts`.
- **لا تغيير مخطّطي (schema) يستلزم هجرة في هذه الجولة** (تعليقات فقط).

> متبقٍ للجولة التالية: تحويل `statistics/dashboard/reports` لتقرأ الإجماليات من الـ Ledger مباشرة (بدل aggregate على جداول الأرباح)، ثم إسقاط `Wallet`/`WalletTransaction` بهجرة مخصصة.


## الجولة الثالثة — التقارير على مصدر الحقيقة الواحد

تحويل التجميعات المالية في لوحة التحكم والتقارير لتقرأ من دفتر الأستاذ (Ledger) مباشرةً بدل جداول الأرباح الموازية:

- `FinancialService.getLedgerRevenue(range?)`: دالة مرجعية تحسب العمولة (إيراد المنصة) وصافي السائق والإجمالي مباشرةً من قيود الـ Ledger على معاملات `settleTrip` المرحّلة (`POSTED`)، مع دعم نطاق تاريخي اختياري.
- `dashboard.service.earnings()`: إجمالي إيراد الشركة/مدفوعات السائقين وإيرادات اليوم/الأسبوع/الشهر أصبحت من `getLedgerRevenue`.
- `statistics.service.revenue()`: `companyEarnings`/`commissions`/`driverNet`/`driverGross` من الـ Ledger؛ بقيت `paymentsCollected`/`withdrawalsPaid` تجميعات تشغيلية.
- `statistics.service.timeseries()`: استعلام SQL الخام يربط الآن `Trip → LedgerTransaction → LedgerEntry → FinancialAccount` ويجمع عمولة المنصّة فقط (`PLATFORM:COMMISSION:%`)، مع `COUNT(DISTINCT t.id)` لتفادي تضاعف الصفوف.
- ربط الوحدات: `DashboardModule` و`ReportsModule` يستوردان الآن `FinancialModule`.
- ما تبقّى كنماذج قراءة (read models) مشتقّة وقابلة لإعادة البناء: قوائم أرباح السائق الفردية (`driver-self`) و`topDrivers` — تُغذّى من الـ Ledger عبر آلية إعادة البناء ولا تُعدّ مصادر مستقلة.

ملاحظة: هذه الجولة لا تتطلّب هجرة قاعدة بيانات (تغييرات كود فقط). يجب تشغيل `npm install && npx prisma generate && npm run build && npm test` في بيئتك للتأكيد النهائي.


## الجولة الرابعة — مهمة reconciliation دورية + سجل incidents

إضافة تحقق دوري من سلامة الأرصدة يقارن `balanceCache` لكل حساب بالرصيد المشتقّ من قيود الـ Ledger المرحّلة:

- **نموذج جديد** `LedgerReconciliationIncident` (+ enum `ReconciliationStatus`: OPEN/RESOLVED/IGNORED) لحفظ أي فرق مع الرصيد المخزّن والمشتقّ والفارق والحالة. هجرة Prisma: `20260713235500_ledger_reconciliation_incident`.
- **`FinancialService.reconcileLedgerBalances()`**: يحسب لكل حساب `Σ CREDIT − Σ DEBIT` من القيود المرحّلة (SQL)، ويقارنه بـ `balanceCache` ضمن تسامح 0.005. أي فرق يُنشئ (أو يحدّث) incident مفتوحًا واحدًا للحساب؛ والحساب الذي يتطابق يُغلق incidentاته القديمة تلقائيًا.
- **Cron كل 30 دقيقة** (`scheduledLedgerReconciliation`) يشغّل التحقق ويسجّل خطأ عند أي عدم تطابق (أساس التنبيهات لاحقًا).
- **نقاط نهاية للوحة التحكم:** `GET financial/reconciliation/incidents` (قائمة مع ترقيم وتصفية بالحالة)، `POST financial/reconciliation/run` (تشغيل يدوي)، `POST financial/reconciliation/incidents/resolve` (إغلاق/تجاهل مع تسجيل المنفّذ) — محمية بصلاحيات `payments.manage`/`reports.read`.
- **دوال نقية + اختبار:** `reconciliation.util.ts` (`deriveAccountBalance`/`accountBalanceDifference`/`isReconciled`) مع `reconciliation.util.spec.ts`.

يتطلّب هجرة: شغّل `npm install && npx prisma generate && npx prisma migrate deploy && npm run build && npm test` في بيئتك.


## الجولة الخامسة — حالات تسوية صريحة (Settlement State Machine) + حرّاس انتقال + تدقيق

كانت التسوية تُدار بحقول متفرّقة (`settledAt`/`settlementError`/`settlementAttempts`) بلا حالة صريحة. الآن:

- **enum `SettlementStatus`** جديد على `Trip`: `NOT_REQUIRED → PENDING → RETRYING/FAILED → POSTED` (POSTED نهائي). حقل `settlementStatus` بافتراضي `NOT_REQUIRED` + فهرس.
- **آلة حالات نقية** `settlement-transitions.ts` (`SETTLEMENT_TRANSITIONS`/`canSettlementTransition`/`isTerminalSettlement`) مع اختبار وحدة — مستقلة عن توليد Prisma مثل `trip-transitions.ts`.
- **حارس انتقال موحّد داخل ****`settleTrip`**: قبل الترحيل يتحقق أن `canSettlementTransition(current, "POSTED")`؛ إن كانت POSTED بالفعل يخرج بلا أثر (idempotent) دون الاعتماد فقط على `settledAt`.
- **انتقالات الحالة مربوطة بالتدفق:** `changeStatus(…COMPLETED)` يضبط `PENDING`؛ نجاح `settleTrip` يضبط `POSTED`؛ فشله يضبط `FAILED`. كلها داخل نفس المعاملة (Serializable) للنجاح.
- **تدقيق لكل انتقال:** قيود `TripEvent` جديدة `settlement:posted` (مع gross/net/commission) و`settlement:failed` (مع سبب الخطأ) بفاعل `SYSTEM`.
- **الاسترداد (Recovery):** cron الدقيقة `retryUnsettledTrips` ينقل الآن `FAILED → POSTED` تلقائيًا عند نجاح إعادة المحاولة.
- **هجرة Prisma** `20260714000500_trip_settlement_status`: إضافة العمود + تعبئة تاريخية (POSTED للمُسوّاة، FAILED/PENDING للمكتملة غير المُسوّاة) لاتساق الآلة مع البيانات القائمة.

يتطلّب هجرة: شغّل `npm install && npx prisma generate && npx prisma migrate deploy && npm run build && npm test` في بيئتك.


## الجولة السابعة — اختبارات تكامل/تزامن/استرداد (إقفال P0)

كانت التغطية تقتصر على اختبارات وحدة للدوال النقية فقط؛ أُضيف الآن مستويان:

**1) ثوابت دفتر الأستاذ في الذاكرة (`ledger-invariants.spec.ts`)** — تعمل دون قاعدة بيانات، تُحاكي قواعد `post()` الفعلية:
- الرصيد يتحرّك +amount عند CREDIT و−amount عند DEBIT، ومجموع الأرصدة يبقى صفرًا (حفظ القيمة).
- رفض القيود غير المتوازنة، المبالغ غير الموجبة، ورموز العملة غير الصالحة.
- **التزامن:** ثلاث مستدعيات متوازية بنفس idempotencyKey → ترحيل واحد فقط (يحاكي قيد التفرّد + عزل Serializable).

**2) اختبارات تكامل مقابل Postgres حقيقية (`financial.integration.spec.ts`)** — مجرّب (harness) يُتخطّى تلقائيًا ما لم تُضبط `TEST_DATABASE_URL` (فلا يكسر `npm test` العادي):
- **تسوية مرة واحدة:** تسوية رحلة مكتملة مرتين → معاملة دفتر أستاذ واحدة POSTED + `settlementStatus=POSTED`.
- **تزامن:** استدعاءان متوازيان → تسوية واحدة (الآخر قد يُرمى بتعارض Serializable — مقبول).
- **استرداد:** رحلة بحالة FAILED يلتقطها `retryUnsettledTrips` → FAILED→POSTED.
- **تسوية دورية:** `reconcileLedgerBalances` يُرجع صفر اختلافات بعد تسوية نظيفة.

لتشغيل اختبارات التكامل:
```
TEST_DATABASE_URL=postgres://... npx prisma migrate deploy
TEST_DATABASE_URL=postgres://... npm test -- financial.integration
```
ملاحظة: حقول البذور (seed) مُرخّاة الأنواع؛ عدّلها إن اختلف مخططك (حقول User/Driver/Trip).


## الجولة الثامنة (P1) — صندوق صادر دائم (Transactional Outbox) + DLQ + إعادة محاولة

كان ناقل الأحداث fire-and-forget (EventEmitter + Redis Pub/Sub) — تُفقد الأحداث عند الفشل. أُضيف الآن:

- **نموذج ****`OutboxEvent`**** (+ enum ****`OutboxStatus`****)** في المخطط: `name`، `payload (Json)`، `status`، `attempts`، `maxAttempts`، `availableAt`، `lastError`، `dedupeKey @unique`، `deliveredAt`، مع فهارس `[status, availableAt]` و`[name]`. هجرة `20260714002000_transactional_outbox`.
- **`OutboxService.enqueue(tx, name, payload, opts)`**: يكتب الحدث **داخل نفس معاملة العمل** (ذرية كاملة) + `enqueueStandalone` مع تجاهل التكرار (P2002).
- **relay دوري (`@Cron` كل 15 ثانية)**: يلتقط الأحداث المستحقة (PENDING/FAILED و`availableAt <= now`)، يُسلّمها عبر ناقل الأحداث، وعند الفشل **تراجع أسّي مع سقف** (5ث → حدّ 1س).
- **DLQ**: بعد بلوغ `maxAttempts` تنتقل الحالة إلى `DEAD` مع تسجيل خطأ؛ دوال `listDeadLetters`، `stats`، `retryDeadLetter` للوحة التحكم.
- **تطبيق فعلي:** `settleTrip` يكتب حدث `trip.settled` عبر الصندوق **داخل معاملة التسوية Serializable** مع `dedupeKey=trip:settled:{tripId}`.
- **منطق نقي + اختبار وحدة** (`outbox.util.ts` / `.spec.ts`): التراجع الأسّي، السقف، انتقال DELIVERED/FAILED/DEAD، وقصّ رسائل الخطأ (500 حرف).

تذكير: التسليم at-least-once — يجب أن يبقى المستهلكون idempotent. شغّل `npx prisma generate && npx prisma migrate deploy && npm run build && npm test` في بيئتك.


---

## الجولة 9 — قفل موزّع (Distributed Lock) [P1]

**الهدف:** منع التسابق (race conditions) في العمليات الحساسة المتزامنة عبر عدة نسخ من الخادم.

### الملفات المضافة
- `src/common/infra/distributed-lock.util.ts` — منطق نقي قابل للاختبار: `lockKey()`، `lockBackoffMs()` (تراجع أسّي مسقوف)، `withJitter()`، وسكربت الإطلاق `LOCK_RELEASE_SCRIPT` (Lua compare-and-delete).
- `src/common/infra/distributed-lock.util.spec.ts` — اختبارات تعمل دون Redis (البادئة، التراجع المسقوف، jitter ضمن [ms/2, ms]).
- `src/common/infra/distributed-lock.service.ts` — `DistributedLockService`:
  - `acquire(name, {ttlMs, timeoutMs})` — `SET key token PX ttl NX` مع إعادة محاولة تراجعية + jitter حتى انتهاء المهلة.
  - `release(name, token)` — إطلاق ذرّي عبر Lua (يحذف فقط إن طابق الرمز).
  - `withLock(name, fn, opts)` — ينفّذ `fn` تحت قفل ويُطلق دائمًا في `finally`.
  - TTL إلزامي يمنع الجمود (deadlock)؛ وعند غياب Redis يعمل بأفضل جهد (الحماية الأساسية تبقى عزل Serializable).

### الملفات المعدّلة
- `src/common/infra/infra.module.ts` — إضافة `DistributedLockService` إلى providers + exports (الوحدة `@Global`).
- `src/modules/financial/financial.service.ts` — حقن `DistributedLockService`؛ `reserveWithdrawal` أصبحت تحت قفل `withdraw:user:{userId}` لتسلسل طلبات السحب المتزامنة لنفس المستخدم (دفاع طبقي فوق عزل Serializable).
- `src/modules/financial/financial.integration.spec.ts` — تمرير قفل صوري كمعامل ثالث للمنشئ.

### التحقق
جميع الملفات اجتازت فحص prettier. لا حاجة لهجرة قاعدة بيانات (القفل في Redis فقط).


---

## الجولة 10 — محرّك التسعير الموحّد: تركيب الأجرة وخريطة التسوية [P1]

**الهدف:** إكمال طبقة التسعير (Quote → Settlement Mapping) بدعم رسوم الانتظار/الإلغاء/الجسور (tolls) والرسوم الإضافية و**مصدر تمويل الكوبون**.

### الخلفية
محرك التسعير (`PricingEngineService`) كان يحلّ قاعدة السعر (منطقة/مدينة/وقت/أولوية) + surge (peakMultiplier) + العمولة. كان ينقصه: توحيد رسوم الانتظار/الإلغاء/الجسور، وتوزيع تمويل الكوبون، وخريطة واضحة تربط الأجرة بتوزيع السائق/المنصة.

### الملفات المضافة
- `src/modules/pricing-engine/fare-breakdown.util.ts` — طبقة نقية بلا DB:
  - `computeWaitingCharge(waitingSeconds, policy)` — دقائق تجاوز المجاني (تقريب لأعلى) × رسوم الدقيقة، مقيّدة بسقف.
  - `computeCancellationFee(stage, policy, elapsed)` — لا رسوم قبل القبول/داخل نافذة السماح، ورسوم بعد القبول/الوصول.
  - `computeCouponDiscount(amount, coupon)` — PERCENT/FIXED مع سقف، وتوزيع التمويل PLATFORM/DRIVER/SHARED.
  - `buildFareBreakdown(input)` — يركّب grossFare وcommission (بدون الجسور) ويوزّع إلى driverNet/platformNet مع ثابت توازن: `riderPays = driverNet + platformNet`.
- `src/modules/pricing-engine/fare-breakdown.util.spec.ts` — اختبارات وحدة تعمل بلا DB (انتظار/إلغاء/كوبون/توزيع + تحقّق توازن المال ومرور الجسور للسائق دون عمولة).

### الملفات المعدّلة
- `src/modules/pricing-engine/pricing-engine.service.ts` — إضافة `composeFare(result, extras)` يفوّض للطبقة النقية (دون تعديل `quote` القائم) — يربط التسعير بخريطة التسوية المالية.

### التحقق
جميع الملفات اجتازت فحص prettier. لا تغيير في schema ولا هجرة (دوال نقية فقط).

> يتبقّى لإغلاق البند نهائيًا: ربط `composeFare` داخل `settleTrip` لاستخدام التوزيع فعليًا في قيود الليدجر، ودمج وحدتي `pricing`/`pricing-engine`، وتخزين سياسات الانتظار/الإلغاء/الكوبون في الإعدادات.


## الجولة 11 (P1) — إعدادات البلدان (Multi-Country Config)

رابع بند P1: جعل النظام متعدّد البلدان فعليًا بدل أي افتراض مثبّت.

**ملفات جديدة:**
- `src/modules/country-config/country-config.util.ts` — طبقة نقية (بلا DB): سجلّ افتراضات `DEFAULT_COUNTRY_CONFIGS` (DZ/AE/SA/FR)، دوال `normalizePhoneE164` (تطبيع إلى E.164)، `computeTax` (INCLUSIVE/EXCLUSIVE)، `resolveCountryConfig`، `isValidCountryCode`.
- `src/modules/country-config/country-config.util.spec.ts` — اختبار وحدة شامل (يعمل بلا DB).
- `src/modules/country-config/country-config.service.ts` — دمج التخصيصات المخزّنة فوق الافتراضات + `currencyFor`/`normalizePhone`/`taxFor`/`upsert`.
- `src/modules/country-config/country-config.controller.ts` — نقاط نهاية STAFF (قائمة/جلب/ضريبة/هاتف/upsert).
- `src/modules/country-config/country-config.module.ts` — يصدّر `CountryConfigService`.

**Schema + هجرة:** نموذج `CountryConfig` + enum `CountryTaxMode`، هجرة `20260714021000_country_config`.
**ربط:** `CountryConfigModule` مضاف إلى `app.module.ts`.

> يتبقّى لاحقًا: استهلاك `currencyFor`/`taxFor` داخل التسعير/المالية، و`normalizePhone` في التسجيل.


## الجولة 13 (P1) — لوحة تحكم تشغيلية (Operational Control Plane)

سادس بند P1: طبقة تجميع توحّد اللوحات التشغيلية الموزّعة في مركز واحد.

**ملفات جديدة:**
- `src/modules/dashboard/ops-center.util.ts` — طبقة نقية (بلا DB): `thresholdSeverity`، `rollupSeverity`، `buildOpsHealth` تحوّل الأعداد الخام إلى حالة صحّية (OK/WARN/CRITICAL) لأربع لوحات.
- `src/modules/dashboard/ops-center.util.spec.ts` — اختبار وحدة شامل (يعمل بلا DB).
- `src/modules/dashboard/ops-center.service.ts` — `overview` يجمع الأعداد بالتوازي + drill-down لطابور التسوية/DLQ/التطابق/المخاطر + إجراءات إعادة المحاولة.
- `src/modules/dashboard/ops-center.controller.ts` — مسار `dashboard/ops` موحّد (STAFF) مع أذونات دقيقة.

**ربط (دون تكرار منطق):** يعتمد على `FinancialService` (settlementQueue / runSettlementBatch / listReconciliationIncidents / resolveReconciliationIncident / reconcileLedgerBalances)، `OutboxService` (stats / listDeadLetters / retryDeadLetter)، `RiskService` (listReviews). `RiskModule` مضاف إلى imports لـ `DashboardModule`.

**نقاط النهاية:** `GET dashboard/ops/overview` (مؤشّر صحّي موحّد)، `settlements` + `settlements/retry`، `dead-letters` + `dead-letters/:id/retry`، `incidents` + `incidents/:id/resolve` + `reconciliation/run`، `risk-reviews`. لا هجرة (يعيد استخدام النماذج القائمة).


---

## 🔄 الجولة 14 (P1): APIs مهيّأة للموبايل — إصدار + أكواد أخطاء موحّدة + رسائل مترجمة

**الهدف:** تجهيز واجهة API لتطبيقات الموبايل: إصدار صارم عبر المسار، وأكواد أخطاء ثابتة يقرأها التطبيق برمجيًا، ورسائل مترجمة حسب `Accept-Language`.

### ملفات جديدة
- `src/common/api/api-error.util.ts` — طبقة نقية: سجلّ `API_ERROR_CODES` (VALIDATION_ERROR، UNAUTHORIZED، FORBIDDEN، NOT_FOUND، CONFLICT، DUPLICATE_REQUEST، INSUFFICIENT_BALANCE، RISK_BLOCKED، RISK_REVIEW، RATE_LIMITED، INTERNAL) مع رسائل ar/en/fr؛ `resolveLocale`، `translateCode`، `httpStatusForCode`، `codeForHttpStatus`، `buildErrorEnvelope`.
- `src/common/api/api-error.util.spec.ts` — اختبار وحدة شامل (بلا DB).
- `src/common/api/app.exception.ts` — `AppException extends HttpException` يحمل `code` + `details` + رسالة اختيارية.
- `src/common/api/api-meta.controller.ts` — `GET /api/meta` عامّة: تُرجع `apiVersion` + `supportedLocales` + فهرس أكواد الأخطاء لبناء خريطة أخطاء أوفلاين.
- `src/common/api/api-meta.module.ts` — `ApiMetaModule`.

### ملفات مُعدّلة
- `src/common/filters/all-exceptions.filter.ts` — يُرجع الآن مغلّفًا موحّدًا `{ success:false, error:{code,message,details}, statusCode, path, requestId, traceId, timestamp }`؛ يشتقّ الكود من `AppException` أو من حالة HTTP؛ يترجم حسب `Accept-Language`؛ لا يسرّب تفاصيل 5xx في الإنتاج.
- `src/main.ts` — `enableVersioning({ type: URI, defaultVersion: ["1", VERSION_NEUTRAL], prefix: "v" })`: تبقى المسارات القديمة (/api/...) تعمل دون كسر، وتتوفر أيضًا تحت /api/v1/....
- `src/app.module.ts` — استيراد `ApiMetaModule`.

### ملاحظات
- لا تغيير في قاعدة البيانات (لا هجرة).
- متغير بيئة جديد اختياري: `API_VERSION` (افتراضي "1").
- الخطوة التالية للتبنّي التدريجي: استبدال `throw new BadRequestException(...)` وأمثالها بـ `throw new AppException("...")` حيثما نريد كودًا ثابتًا للموبايل.


---

## الجولة 15 (P1 — المراقبة الكاملة / Full Observability)

آخر بند P1: اكتمال طبقة المراقبة (تتبّع موزّع متوافق مع OpenTelemetry + توصيل تنبيهات خارجي + Runbooks). بذلك تكتمل جميع بنود P0 وP1.

### ملفات جديدة
- `src/common/observability/tracing.util.ts` (+ `.spec.ts`): طبقة تتبّع نقية متوافقة مع W3C Trace Context / OpenTelemetry — توليد traceId/spanId، تحليل/بناء `traceparent`، وبناء سجل span (دوال نقية قابلة للاختبار).
- `src/common/observability/alert.util.ts` (+ `.spec.ts`): طبقة تنبيهات نقية — تصنيف خطورة، مفتاح dedup، خنق (throttle)، وتنسيق حمولة Slack/webhook.
- `src/common/observability/tracer.service.ts`: `TracerService` — `startSpan`/`withSpan` ترث traceId من سياق الطلب وتُصدّر spans كـ JSON مُهيكل (قابل لإبدال المُصدّر بـ OTLP لاحقًا دون تغيير العقد).
- `src/common/observability/alert.service.ts`: `AlertService` — توصيل تنبيهات best-effort إلى `ALERT_WEBHOOK_URL` (Slack/webhook) عبر `fetch` مع timeout وخنق تكرار، وتسجيل محلي دائم مربوط بـ traceId.
- `RUNBOOKS.md`: دليل استجابة للحوادث لكل نوع تنبيه (عدم التطابق، فشل التسوية، DLQ، المخاطر، Redis).

### تعديلات
- `observability.module.ts`: أصبح `@Global` ويوفّر/يُصدّر `TracerService` و`AlertService` (إضافة لـ `StructuredLogger`).
- `context.middleware.ts`: يحترم `traceparent` الوارد (W3C) ويُرجعه في الاستجابة لربط الطلب عبر الخدمات.
- `financial.service.ts`: حقن `AlertService` اختياريًا (`@Optional`)؛ يُطلق تنبيهًا CRITICAL عند عدم تطابق رصيد حساب وعند وجود اختلافات في الفحص الدوري.

### متغيرات بيئة جديدة
- `ALERT_WEBHOOK_URL` (افتراضيًا لا شيء — تسجيل محلي فقط)، `ALERT_THROTTLE_MS` (افتراضي 300000)، `TRACING_ENABLED` (افتراضي true).

### ملاحظات
- لا تغيير في schema/migrations. لا حزم npm جديدة (التتبّع متوافق مع OTel دون اعتماد SDK خارجي).
- الإدخال الاختياري `@Optional()` يحافظ على عمل اختبارات `FinancialService` الحالية دون تعديل.


## الجولة 17 (ربط تشغيلي) — تفعيل محرّك المخاطر في مسار السحب

بعد اكتمال P0+P1+P2، بدأنا مرحلة "الربط التشغيلي" (ربط الخدمات المبنية بالمسارات الحيّة).

- **`WithdrawalsService.createForDriver`** أصبح يستدعي `RiskService.assess` قبل إنشاء طلب السحب وقبل حجز الرصيد.
- يجمع التقييم: تاريخ السحب خلال آخر 24 ساعة (لفحص السرعة، حد 5 طلبات)، متوسّط مبالغ السحب السابقة (لكشف شذوذ المبلغ)، وفحص قائمة الحظر على المستخدم والهاتف.
- قرار **BLOCK** → يُرفض الطلب بـ `ForbiddenException` قبل أي حجز مالي. قرار **REVIEW** → يُسجَّل في طابور المراجعة اليدوية (عبر `RiskService.assess`) ويُسمح بالطلب. كل تقييم يُسجَّل كـ `RiskEvent` للتدقيق.
- `PaymentsModule` يستورد الآن `RiskModule`. لا تغيير في schema/migrations، ولا حزم جديدة. اجتاز الملفان فحص prettier.

> التالي في الربط التشغيلي: `RiskService.assess` في مساري الدفع والتحويل، و`composeFare` داخل `settleTrip`، و`CityScalingService.evaluateAcceptance` في المطابقة.


## الجولة 18 (ربط تشغيلي) — محرّك المخاطر في مساري الدفع والتحويل

استكمالًا للربط التشغيلي، وُصِل `RiskService.assess` بمسارين حيّين إضافيين (بعد مسار السحب في الجولة 17):

- **`PaymentsService.createCheckoutForTrip`** يستدعي `assessPaymentRisk` قبل إنشاء الجلسة مع المزوّد: فحص سرعة الدفع (حد 10 عمليات/24ساعة)، شذوذ المبلغ مقابل متوسّط المدفوعات المحصّلة، عدد الاستردادات (chargeback proxy)، وفحص قائمة الحظر على الراكب. قرار `BLOCK` → رفض قبل أي اتصال ببوّابة الدفع.
- **`DriverTransfersService.create`** يستدعي `assessTransferRisk` بعد فحص الرصيد وقبل إنشاء التحويل: فحص سرعة التحويل (حد 5/24ساعة)، شذوذ المبلغ، وفحص قائمة الحظر على السائق المرسِل وهاتفه. قرار `BLOCK` → `ForbiddenException`.
- **السلوك الموحّد:** `BLOCK` يرفض قبل أي حركة مالية؛ `REVIEW` يُسجَّل في طابور المراجعة ويُسمح؛ وكل تقييم يُسجَّل كـ `RiskEvent`.
- لا تغيير في schema/migrations ولا حزم جديدة (`RiskModule` مستورَد منذ الجولة 17)؛ اجتاز الملفان فحص prettier.

> التالي في الربط التشغيلي: `composeFare` داخل `settleTrip`، ثم `CountryConfigService.currencyFor/taxFor` في التسعير/المالية، ثم `CityScalingService.evaluateAcceptance` في المطابقة و`GrowthService.assign` في التسعير.

## الجولة 20 (ربط تشغيلي) — إعدادات البلد + توسّع المدن + تجارب النمو + تطبيع الهاتف

استكمالًا للربط التشغيلي بعد الجولة 19، وُصِلت الخدمات الجاهزة بالمسارات الحية التالية:

- **التسعير والمالية:** `PricingEngineService.quote` يحل البلد من السياق/المدينة ويستدعي `CountryConfigService.taxFor` و`currencyFor`، ويُرجع لقطة `taxNet/taxAmount/taxGross/countryCode`.
- **التحقق المالي:** `FinancialService.settleTrip` يتحقق من تطابق عملة الرحلة مع عملة البلد قبل أي قيد Ledger (`TRIP_CURRENCY_COUNTRY_MISMATCH`).
- **المطابقة وتوسّع المدن:** `MatchingService.requestRide` يستدعي `CityScalingService.evaluateAcceptance` قبل إنشاء الرحلة، ويمنع الطلب عند تجاوز السعة (`CITY_CAPACITY_REJECTED`).
- **الذروة والسعة:** محرك التسعير يمرّر مضاعف الذروة عبر `cappedSurge` الخاص بالمدينة.
- **تجارب التسعير A/B:** أُضيف `subjectId` إلى سياق التسعير، ويستدعي المحرك `GrowthService.assign` بمفتاح `PRICING_EXPERIMENT_KEY` ويعيد `experimentVariant` دون كسر التسعير عند غياب تجربة نشطة.
- **التدقيق:** يحفظ حدث `trip:requested` متغيّر التجربة والبلد وقيم الضريبة في `meta`.
- **الهوية:** أُضيف `countryCode` اختياري للتسجيل والدخول، ويطبّق `AuthService` دالة `normalizePhone` قبل البحث/الإنشاء مع `DEFAULT_COUNTRY_CODE` مركزي.
- **العملة الافتراضية:** `GrowthService` لم يعد يثبت `DZD` في الحوافز؛ يستخدم `DEFAULT_CURRENCY`.

### التحقق
- لا schema/migrations ولا حزم جديدة.
- هذه هي **مرحلة 20 فقط**، دون تنفيذ المراحل اللاحقة.


## الجولة 19 (ربط تشغيلي) — خريطة الأجرة الموحّدة داخل تسوية الرحلة

وُصِل `PricingEngineService.composeFare` فعليًا بمسار `FinancialService.settleTrip` بدل الاعتماد على القسمة القديمة المعزولة في `computeSettlement`:

- تستدعي التسوية الآن `composeFare` باستخدام الأجرة النهائية ونسبة العمولة المحفوظتين على الرحلة.
- قيود الـ Ledger تستخدم مخرجات الخريطة الموحّدة: `riderPays` للمبلغ المدين، و`driverNet` لدائن السائق، و`platformNet` لدائن المنصّة؛ وبذلك يبقى ثابت التوازن `riderPays = driverNet + platformNet` في مصدر واحد.
- أُزيل استيراد `computeSettlement` القديم من `FinancialService`، مع بقاء الدالة كأداة نقية متوافقة للاختبارات/الاستخدامات الأخرى.
- لأن `trip.fare` تُخزّن أصلًا **بعد تطبيق الكوبون** في مسار المطابقة، لا تعيد التسوية تطبيق الكوبون مرة ثانية؛ هذا يمنع الخصم المزدوج ويحافظ على السلوك المالي القائم.
- استورد `FinancialModule` وحدة `PricingEngineModule`، وحُدّث اختبار التكامل ليحقن `PricingEngineService`.
- لا تغيير في schema/migrations ولا حزم جديدة؛ اجتازت الملفات الأربعة فحص prettier.

> التالي في الربط التشغيلي: استهلاك `CountryConfigService.currencyFor/taxFor` في التسعير/المالية، ثم `CityScalingService.evaluateAcceptance` في المطابقة، ثم `GrowthService.assign` في التسعير.


## الجولة 21 (تشغيل المراقبة فعليًا) — Tracing للمسارات الحرجة

بعد اكتمال بنية المراقبة، وُصِل `TracerService.withSpan` فعليًا بمسارات تشغيلية حسّاسة بدل الاكتفاء بوجود الخدمة فقط:

- **المدفوعات:** `PaymentsService.createCheckoutForTrip` و`processWebhook` داخل spans (`payments.create_checkout`, `payments.process_webhook`).
- **السحب:** `WithdrawalsService.createForDriver` داخل span (`withdrawals.create_request`).
- **المطابقة:** `MatchingService.requestRide` و`runMatching` داخل spans (`matching.request_ride`, `matching.run`).
- **المالية:** `FinancialService.settleTrip` و`reserveWithdrawal` داخل spans (`financial.settle_trip`, `financial.reserve_withdrawal`).
- **التوافق:** حقن `TracerService` اختياري (`@Optional`) لحماية الإنشاءات اليدوية والاختبارات.

### التحقق
- لا schema/migrations ولا حزم جديدة.
- هذه هي **مرحلة 21 فقط** فوق المرحلة 20.


## الجولة 22 (عقد أخطاء المجال) — أكواد ثابتة للمسارات الحرجة

استُبدلت الاستثناءات النصية في المسارات الحرجة التي رُبطت في الجولة 21 بـ `AppException` وأكواد مجال ثابتة يقرأها تطبيق الموبايل برمجيًا:

- **الرحلات:** `ACTIVE_TRIP_EXISTS`, `CITY_CAPACITY_REJECTED`, `TRIP_NOT_FOUND`, `TRIP_FARE_UNAVAILABLE`.
- **السحب/المالية:** `DRIVER_NOT_FOUND`, `WITHDRAWAL_NOT_FOUND`, `SETTLEMENT_NOT_ELIGIBLE`, `CURRENCY_COUNTRY_MISMATCH`, مع إعادة استخدام `INSUFFICIENT_BALANCE`.
- **الأمان:** إعادة استخدام `RISK_BLOCKED` في مساري الدفع والسحب بدل رسالة نصية فقط.
- **الهوية:** `INVALID_PHONE_NUMBER`, `PHONE_ALREADY_REGISTERED`, `INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`.
- كل كود يملك حالة HTTP ورسائل `ar/en/fr` في سجل `API_ERROR_CODES`، ويظهر تلقائيًا في `GET /api/meta`.
- أُضيفت اختبارات لعقد حالات HTTP والترجمة. لا schema/migrations ولا حزم جديدة.

> هذه هي **مرحلة 22 فقط**؛ لم تُنفذ المرحلة التالية.


## الجولة 23 (آلة حالات السحب) — انتقالات محروسة وتدقيق ذري

أُغلق تدفق حالة `WithdrawRequest` بآلة حالات موحّدة بدل الشروط المتفرقة:

- المسار المالي الإلزامي: `PENDING → APPROVED → PAID`.
- الرفض مسموح فقط عبر `PENDING → REJECTED`.
- `PAID` و`REJECTED` حالتان نهائيتان، ومُنع `PENDING → PAID` المباشر.
- كل انتقال يعمل تحت قفل موزّع `withdrawal:transition:{id}`، مع تحديث شرطي ذري (`id + current status`) لمنع سباق الدفع/الرفض عبر النسخ.
- تغيير الحالة وسجل `AuditLog` (`WITHDRAWAL_STATUS_CHANGED`) يُكتبان داخل نفس معاملة قاعدة البيانات.
- أُضيف كود ثابت `INVALID_WITHDRAWAL_TRANSITION` برسائل ar/en/fr وتفاصيل `from/to`.
- أُضيفت آلة نقية `withdrawal-transitions.ts` واختبارات للمسار الصحيح والحالات النهائية ومنع الدفع قبل الاعتماد.
- لا تغيير في schema/migrations ولا حزم جديدة.

> هذه هي **مرحلة 23 فقط**؛ تجهيز واجهة Dashboard يبدأ في المرحلة 25 بعد إغلاق Wallet القديم في المرحلة 24.


## الجولة 24 (إغلاق Wallet القديم) — Ledger مصدر الحقيقة الوحيد

أُزيلت النماذج التشغيلية القديمة `Wallet` و`WalletTransaction` و`WalletTxType` من Prisma ومن جميع مسارات التطبيق:

- التسجيل وFirebase لا ينشئان Wallet موازية بعد الآن.
- `WalletService` و`GET /wallet/me` باقيان كواجهة توافق، لكنهما يقرآن الرصيد والحركات حصريًا من `FinancialAccount` و`LedgerEntry` ويعيدان `source: LEDGER`.
- تفاصيل المستخدم تقرأ `ledgerBalance` من `FinancialService`، مع حقل `wallet` توافقي مشتق من نفس Ledger مؤقتًا للواجهات القديمة.
- أزيل DTO التعديل اليدوي القديم المرتبط بـ`WalletTxType`، فلا يوجد عقد API يسمح بتعديل رصيد Wallet مباشر.
- migration `20260714130000_close_legacy_wallet` تحفظ لقطة كاملة في `LegacyWalletArchive`، وتنشئ حسابات Ledger الناقصة، وترحّل فقط الأرصدة اليتيمة التي لا تملك أي تاريخ Ledger كقيود افتتاحية مزدوجة ومتوازنة، ثم تُسقط الجدولين والـenum القديم.
- Wallet التي لديها نشاط Ledger تُؤرشف فقط ولا يُعاد استيرادها، لمنع مضاعفة رصيد مرآة قديمة.

> النتيجة: الرصيد التشغيلي له مصدر حقيقة واحد هو Ledger. هذه هي **مرحلة 24 فقط**؛ المرحلة 25 تبدأ تجهيز Dashboard.
