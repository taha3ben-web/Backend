# NOVA Ride — Backend (NestJS + Prisma + PostgreSQL + Redis)

الدماغ المركزي لمنصة NOVA Ride. مبني بمعمارية نظيفة (Clean Architecture) وجاهز للتوسع.

> **ملاحظة مهمة عن المراحل**: هذه **المرحلة الأولى (الأساس الإنتاجي)**: قاعدة بيانات كاملة + مصادقة + WebSocket + الوحدات الأساسية. المراحل التالية (المدفوعات، الكوبونات، الإشعارات، التقارير، لوحة التحكم) مذكورة في قسم خارطة الطريق.

## التقنيات

- **NestJS** + **TypeScript** (strict)
- **Prisma ORM** + **PostgreSQL**
- **Redis** (المواقع الجغرافية GEO + الحضور + الكاش)
- **Socket.IO** (WebSocket)
- **JWT + Refresh Tokens** + bcrypt
- **Docker** + docker-compose

## البنية

```
src/
  config/            الإعدادات
  prisma/            اتصال قاعدة البيانات
  common/            الحراس (Guards) + RBAC + DTO مشتركة
  modules/
    auth/            تسجيل / دخول / refresh / logout
    users/           إدارة الركاب
    drivers/         إدارة السائقين + مراجعة الوثائق
    trips/           الرحلات + آلة الحالات
    dashboard/       الإحصائيات + الخريطة الحية
    realtime/        WebSocket gateway
    redis/           خدمة Redis
    health/          فحص الحالة
prisma/schema.prisma مخطط قاعدة البيانات الكامل (35+ جدول)
prisma/seed.ts       بيانات أولية (مدير + مدينة + تسعير)
```

## التشغيل الأسرع (Docker — يشغّل كل شيء)

```bash
cp .env.example .env      # عدّل الأسرار
docker compose up --build
# الخادم: http://localhost:4000/api/health
```

ثم أنشئ الجداول والبيانات الأولية:

```bash
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run seed
```

## التشغيل محليًا (بدون Docker)

يتطلب PostgreSQL و Redis يعملان.

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run start:dev
```

حساب المدير الافتراضي: الهاتف `0000000000` — الكلمة `admin1234` (غيّرها فورًا).

## أمثلة API

```
GET  /api/health
POST /api/auth/register     { name, phone, password, role: PASSENGER|DRIVER }
POST /api/auth/login        { phone, password }
POST /api/auth/firebase     { idToken, role?, name?, phone? }   # جسر الهوية
POST /api/auth/refresh      { refreshToken }
POST /api/auth/logout       (Bearer)

# لوحة التحكم (تتطلب حساب STAFF)
GET  /api/dashboard/summary
GET  /api/dashboard/earnings
GET  /api/dashboard/latest
GET  /api/dashboard/live-map

GET   /api/drivers?page=1&limit=20&status=PENDING&search=...
GET   /api/drivers/:id
PATCH /api/drivers/:id/approve | /reject | /suspend | /ban
PATCH /api/drivers/documents/:docId/review   { status, note }

GET   /api/passengers?page=1&search=...
PATCH /api/passengers/:id/suspend | /ban | /activate

GET   /api/trips?status=IN_PROGRESS
GET   /api/trips/:id
PATCH /api/trips/:id/status   { status, reason }
# عند تحويل الرحلة إلى COMPLETED تتم التسوية المالية تلقائيًا:
#   دفعة الراكب + أرباح السائق + عمولة الشركة + إضافة صافي الربح لمحفظة السائق.

# المحفظة (Wallet)
GET   /api/wallet/me?page=1&limit=20        الرصيد + آخر الحركات (المستخدم الحالي)
POST  /api/wallet/me/top-up                 { amount, method?, reference? }
GET   /api/wallet/:userId                   محفظة مستخدم معيّن (STAFF)
PATCH /api/wallet/:userId/adjust            { type: CREDIT|DEBIT, amount, reason? } (STAFF)

# المدفوعات (Payments) — STAFF
GET   /api/payments?page=1&status=PENDING|PAID|FAILED|REFUNDED
GET   /api/payments/:id
POST  /api/payments                         { tripId, method?, reference? }
PATCH /api/payments/:id/status              { status, reference? }  (REFUNDED يعيد المبلغ للمحفظة)

# الكوبونات (Coupons)
POST   /api/coupons/validate              { code, fare }   تحقق الراكب من الخصم قبل الطلب
# إدارة (STAFF):
POST   /api/coupons                       { code, type, value, maxUses?, firstRideOnly?, userId?, expiresAt? }
GET    /api/coupons?page=1&search=CODE     قائمة الكوبونات
GET    /api/coupons/:id
PATCH  /api/coupons/:id                    تعديل كوبون
DELETE /api/coupons/:id                    تعطيل كوبون
# ملاحظة: مرّر couponCode في POST /api/rides/request لتطبيق الخصم تلقائيًا.

# التسعير (Pricing — STAFF)
GET    /api/pricing/rules                  قواعد التسعير (مع المدينة وتسعير الذروة)
POST   /api/pricing/rules                  { cityId?, rideClass?, baseFare, perKm, perMin, minFare, maxFare?, currency? }
PATCH  /api/pricing/rules/:id
DELETE /api/pricing/rules/:id
POST   /api/pricing/peak                   { pricingRuleId, name, multiplier, startTime, endTime, daysOfWeek?, isActive? }
DELETE /api/pricing/peak/:id

# RBAC — الأدوار والصلاحيات (تتطلب staff.manage)
GET    /api/rbac/roles                        قائمة الأدوار + صلاحياتها
GET    /api/rbac/roles/:id
POST   /api/rbac/roles                        { name, description?, permissionKeys? }
PATCH  /api/rbac/roles/:id                     { description?, permissionKeys? }
PUT    /api/rbac/roles/:id/permissions        { permissionKeys: [...] }
DELETE /api/rbac/roles/:id
GET    /api/rbac/permissions                   قائمة الصلاحيات
POST   /api/rbac/permissions                  { key, description? }

# إدارة الموظفين (تتطلب staff.manage)
GET    /api/staff?page=1&search=               قائمة الموظفين
POST   /api/staff                             { name, phone, password, roleId }  إنشاء موظف
PATCH  /api/staff/:id/role                     { roleId }  تغيير دور موظف

# السجلات (تتطلب audit.read)
GET    /api/logs/audit?page=1&actorId=&entity= سجل التدقيق (من/متى/IP/العملية)
GET    /api/logs/activity?page=1&userId=       سجل النشاط

# الإحصائيات (Statistics) — STAFF
GET    /api/statistics/overview?from=&to=     ملخص الرحلات/النمو ونسبة الإتمام
GET    /api/statistics/revenue?from=&to=      الإيرادات والعمولات والمدفوعات
GET    /api/statistics/timeseries?from=&to=   سلسلة يومية (رحلات + إيراد) للرسوم
GET    /api/statistics/top-drivers            أفضل السائقين
GET    /api/statistics/top-cities             أكثر المدن نشاطاً

# التقارير (Reports PDF/Excel) — STAFF
GET /api/reports/:type?format=pdf|excel&from=&to=&limit=
  :type = revenue | trips | drivers | passengers | top-drivers | top-cities
  مثال: /api/reports/revenue?format=excel&from=2026-01-01&to=2026-02-01

# الدعم الفني (Support)
POST   /api/support/tickets               { subject, category?, message }  فتح تذكرة
GET    /api/support/tickets/me?page=1      تذاكر المستخدم
GET    /api/support/tickets/:id           تفاصيل التذكرة + المحادثة
POST   /api/support/tickets/:id/messages  { body }  إضافة رد/رسالة
GET    /api/support/tickets?status=OPEN    كل التذاكر (STAFF)
PATCH  /api/support/tickets/:id/status     { status }  حل/إغلاق (STAFF)

# الشكاوى (Complaints)
POST   /api/support/complaints            { tripId?, againstUserId?, message }  تقديم شكوى
GET    /api/support/complaints?status=OPEN كل الشكاوى (STAFF)
GET    /api/support/complaints/:id        (STAFF)
PATCH  /api/support/complaints/:id/status  { status: OPEN|REVIEWING|RESOLVED }  (STAFF)

# التقييمات (Ratings)
POST   /api/ratings                       { tripId, stars(1-5), comment? }  تقييم الطرف الآخر
GET    /api/ratings/user/:userId?page=1    تقييمات مستخدم + المتوسط

# الإشعارات (Notifications)
POST   /api/notifications/devices          { token, platform }   تسجيل توكن جهاز (أي مستخدم)
DELETE /api/notifications/devices/:token   إزالة توكن جهاز
GET    /api/notifications/me?page=1        إشعارات المستخدم الحالي
# إدارة (STAFF):
POST   /api/notifications                  { target: ALL|DRIVERS|PASSENGERS|USER, channel: PUSH|SMS|EMAIL|IN_APP,
#                                            userId?, title, body, data?, scheduledAt? }  (scheduledAt للجدولة)
GET    /api/notifications?page=1&target=ALL  سجل الإشعارات
DELETE /api/notifications/:id              إلغاء إشعار مجدول لم يُرسل بعد

# محرك المطابقة (Matching) — ربط الراكب بالسائق
POST  /api/rides/quote                      { pickupLat, pickupLng, destLat, destLng, rideClass?, cityId? }  تقدير الأجرة
POST  /api/rides/request                    { pickup..., dest..., rideClass?, cityId? }  (الراكب — يبدأ البحث)
PATCH /api/rides/:id/cancel                  إلغاء البحث (الراكب)

# طلبات السحب (Withdrawals)
POST  /api/withdrawals                      { amount, note? }   (السائق — يحجز المبلغ من محفظته)
GET   /api/withdrawals?status=PENDING|APPROVED|REJECTED|PAID    (STAFF)
PATCH /api/withdrawals/:id/approve          { note? }  (STAFF)
PATCH /api/withdrawals/:id/paid             { note? }  (STAFF — تأكيد التحويل)
PATCH /api/withdrawals/:id/reject           { note? }  (STAFF — يعيد المبلغ للمحفظة)
```

## WebSocket

الاتصال يتطلب توكن JWT:

```js
const socket = io("http://localhost:4000", { auth: { token: accessToken } });

// السائق يرسل موقعه كل 1–2 ثانية
socket.emit("driver:location", { lat, lng, heading });

// الراكب ينضم لغرفة رحلته ثم يستقبل حركة السيارة
socket.emit("trip:join", { tripId });
socket.on("driver:moved", (p) => {
  /* حرّك الماركر */
});
socket.on("trip:status", (p) => {
  /* حدّث الحالة */
});

// المدير (STAFF) ينضم تلقائيًا لغرفة admins ويستقبل كل التحركات
```

### محرك المطابقة ��بر WebSocket

```js
// 1) الراكب يطلب رحلة (بديل عن REST)
socket.emit("ride:request", { pickupLat, pickupLng, destLat, destLng });
socket.on("ride:searching", ({ tripId, fare }) => {});

// 2) السائق يستقبل عرضًا (مهلة القبول 15 ثانية)
socket.on("ride:offer", (offer) => {
  // offer = { tripId, pickup..., dest..., fare, distanceKm, expiresInMs }
  socket.emit("ride:accept", { tripId: offer.tripId }); // أو ride:decline
});
socket.on("ride:offer_expired", ({ tripId }) => {});

// 3) الراكب يُخطر عند القبول أو عدم توفر سائق
socket.on("ride:accepted", ({ tripId, driverId }) => {});
socket.on("ride:no_drivers", ({ tripId }) => {});

// 4) السائق الفائز يُخطر بالتعيين
socket.on("ride:assigned", ({ tripId }) => {});
```

**آلية المطابقة:** بحث Redis GEO ضمن 5 كم (يتوسع إلى 10 كم) → فلترة السائقين (APPROVED + ONLINE + غير مشغولين) → عرض تسلسلي واحدًا تلو الآخر مع مهلة قبول لكل سائق → أول من يقبل يفوز (قفل ذرّي) → إن رفض الجميع تُلغى الرحلة تلقائيًا مع سبب «لا يوجد سائق متاح».

## الأمان المفعّل

- Helmet + CORS + Rate Limiting (Throttler).
- Validation صارم (whitelist + forbidNonWhitelisted) → يمنع الحقول غير المعرّفة.
- Prisma يستخدم parameterized queries → حماية من SQL Injection.
- JWT + Refresh Tokens (مع تدوير وإلغاء) + bcrypt للكلمات.
- RBAC عبر RolesGuard + @Roles.

## سجل النشاط وصلاحيات الموظفين (RBAC)

- **سجل التدقيق (Audit)**: `AuditInterceptor` عالمي يسجّل تلقائيًا كل عمليات الكتابة (POST/PATCH/PUT/DELETE): من قام بها (actorId)، وقتها، عنوان IP، User-Agent، ونوع العملية (المسار). التسجيل fire-and-forget ولا يؤثر على زمن الاستجابة.
- **صلاحيات دقيقة (RBAC)**: `PermissionsGuard` + `@RequirePermissions("key")` يحمّل صلاحيات دور الموظف من قاعدة البيانات. صاحب الصلاحية `*` (مدير عام) يمرّ دائمًا.
- **الأدوار المبدئية (seed)**: `SUPER_ADMIN` (مدير عام `*`)، `OPERATIONS` (مدير عمليات)، `SUPPORT` (دعم فني)، `SUPERVISOR` (مشرف)، `DOC_REVIEWER` (مراجع وثائق). حساب المدير الافتراضي مربوط بـ SUPER_ADMIN.
- المدير ينشئ أدوارًا جديدة، يربط صلاحيات، ينشئ موظفين، ويغيّر أدوارهم — كلها محمية بصلاحية `staff.manage`.

## التقارير والإحصائيات

- **الإحصائيات (JSON)**: ملخص عام (رحلات/مكتملة/ملغاة/نسبة الإتمام/مستخدمون جدد)، الإيرادات (إيراد الشركة/العمولات/دخل السائقين الإجمالي والصافي/المدفوعات/السحوبات)، سلسلة زمنية يومية للرسوم البيانية، أفضل السائقين، وأكثر المدن نشاطاً — كلها تدعم نطاقاً زمنياً `from`/`to` (افتراضي آخر 30 يوماً).
- **التقارير القابلة للتنزيل**: تُولَّد بصيغة **Excel (.xlsx)** حقيقية عبر `exceljs` (رأس ملوّن + تجميد الصف الأول + اتجاه RTL، تدعم العربية تماماً)، أو **PDF** حقيقي عبر `pdfkit` (جداول متعددة الصفحات).
- **دعم العربية في PDF**: `pdfkit` يعرض اللاتينية والأرقام مباشرة. لعرض النصوص العربية في PDF، ضع خط TTF عربي في `assets/fonts/NotoNaskhArabic-Regular.ttf` — يُلتقط تلقائياً؛ وإلا يستخدم Helvetica. للبيانات الغنية بالعربية استخدم صيغة Excel التي تدعمها بالكامل.

## الدعم الفني والشكاوى والتقييمات

- **الدعم (تذاكر)**: المستخدم يفتح تذكرة بموضوع + تصنيف + أول رسالة، ثم محادثة متبادلة. رد الدعم يحوّل الحالة إلى PENDING ورد المستخدم يعيدها OPEN؛ الدعم يحل/يغلق. المستخدم يرى تذاكره فقط، والدعم يرى الكل.
- **الشكاوى**: أي مستخدم يقدّم شكوى (ربما ضد طرف أو مرتبطة برحلة)؛ الدعم يراجع ويحل (مع تسجيل المُحل ووقت الحل).
- **التقييمات**: بعد اكتمال الرحلة يُقيّم كل طرف الآخر (1-5 نجوم + تعليق). يُمنع التكرار، ويُعاد حساب متوسط تقييم السائق تلقائيًا.

## الكوبونات والتسعير

- **الكوبونات**: نوع الخصم `PERCENT` (نسبة) أو `FIXED` (قيمة ثابتة)، مع حد أقصى للاستخدامات، تاريخ انتهاء، تخصيص لمستخدم معيّن، وخيار “الرحلة الأولى فقط”.
- عند طلب رحلة مع `couponCode`: يُتحقق الكوبون ، يُحسب الخصم (لا يتجاوز الأجرة)، يُحجز الاستخدام (usedCount++)، ويُربط بالرحلة. عند الإلغاء يُعاد الاس��خدام تلقائيًا.
- **التسعير**: قواعد حسب المدينة وفئة الرحلة (سعر البداية/الكيلومتر/الدقيقة/الحد الأدنى والأقصى) + تسعير الذروة (مضاعف حسب الوقت وأيام الأسبوع). يستخدمها محرك التسعير عند حساب الأجرة.

## الإشعارات (Push / SMS / Email / In-App + جدولة)

- **القنوات**: `PUSH` (Firebase FCM)، `SMS` (بوابة HTTP)، `EMAIL` (مزوّد HTTP مثل Resend/SendGrid)، `IN_APP` (فوري عبر WebSocket).
- **الأهداف**: `ALL` / `DRIVERS` / `PASSENGERS` / `USER` (مستخدم محدد).
- **الجدولة**: مرّر `scheduledAt` (ISO) فيُخزَّن الإشعار ويُرسله مهمة Cron كل دقيقة عند استحقاقه. بدونه يُرسل فورًا.
- **الأمان**: كل مزوّد يعمل فقط إذا ضُبطت مفاتيحه في `.env`، وإلا يُسجّل تحذيرًا ويتخطى بأمان دون كسر النظام.
- متغيرات البيئة الاختيارية: `FCM_SERVER_KEY`، `SMS_API_URL`/`SMS_API_KEY`/`SMS_SENDER`، `EMAIL_API_URL`/`EMAIL_API_KEY`/`EMAIL_FROM`.
- استقبال الإشعار الفوري في التطبيق: `socket.on("notification", ({ title, body, data }) => {})`.

## النشر على Google Cloud (مُوصى به للإنتاج)

المشروع مهيأ لـ Google Cloud (محمول بالكامل — لا ارتباط قسري). خريطة الخدمات:

| المكوّن | خدمة GCP |
|---|---|
| خادم NestJS | **Cloud Run** (أو Compute Engine) |
| قاعدة البيانات | **Cloud SQL for PostgreSQL** |
| Redis | **Memorystore for Redis** |
| الملفات/الوثائق/التقارير | **Cloud Storage** |
| الإشعارات | **Firebase Cloud Messaging (FCM)** |
| الأسرار | **Secret Manager** |
| صور Docker | **Artifact Registry** |
| البناء والنشر | **Cloud Build** (`cloudbuild.yaml`) |
| السجلات/المراقبة | **Cloud Logging / Monitoring** (تلقائي مع Cloud Run) |
| توزيع الضغط | **Cloud Load Balancing** + Socket.IO Redis Adapter |

### 1) تهيئة لمرة واحدة

```bash
gcloud auth login
gcloud config set project <PROJECT_ID>

# تفعيل الخدمات
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  redis.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com \
  vpcaccess.googleapis.com

# مستودع صور Docker
gcloud artifacts repositories create nova --repository-format=docker \
  --location=europe-west1
```

### 2) قاعدة البيانات (Cloud SQL) و Redis (Memorystore)

```bash
# Cloud SQL PostgreSQL
gcloud sql instances create nova-db --database-version=POSTGRES_15 \
  --tier=db-f1-micro --region=europe-west1
gcloud sql databases create nova --instance=nova-db
gcloud sql users create nova --instance=nova-db --password=<STRONG_PASSWORD>

# Memorystore Redis (يحتاج VPC Connector لوصل Cloud Run بالشبكة الخاصة)
gcloud redis instances create nova-redis --size=1 --region=europe-west1
gcloud compute networks vpc-access connectors create nova-connector \
  --region=europe-west1 --range=10.8.0.0/28
```

### 3) تخزين الملفات (Cloud Storage)

```bash
gsutil mb -l europe-west1 gs://<PROJECT_ID>-nova-files
# الـ bucket يبقى خاصًا؛ الوصول عبر روابط موقّعة (signed URLs) من الخادم.
```

### 4) الأسرار (Secret Manager)

```bash
# مثال: رابط قاعدة البيانات (عبر Cloud SQL socket)
printf 'postgresql://nova:<PASSWORD>@localhost/nova?host=/cloudsql/<PROJECT_ID>:europe-west1:nova-db' \
  | gcloud secrets create database-url --data-file=-

# باقي الأسرار (الأسماء بأحرف صغيرة وشرطات):
#   redis-url, jwt-access-secret, jwt-refresh-secret,
#   firebase-project-id, firebase-client-email, firebase-private-key, fcm-server-key
printf '<VALUE>' | gcloud secrets create jwt-access-secret --data-file=-

# منح Cloud Run صلاحية القراءة
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

> الخادم يقرأ هذه الأسرار تلقائيًا عند الإقلاع إذا كان `USE_SECRET_MANAGER=true` (مضبوط في `cloudbuild.yaml`).

### 5) البناء والنشر (Cloud Build → Cloud Run)

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_REGION=europe-west1,_SERVICE=nova-backend,_AR_REPO=nova
```

بعد أول نشر، أزل التعليق عن سطري `--add-cloudsql-instances` و `--vpc-connector` في `cloudbuild.yaml`
واضبط `_CLOUD_SQL_INSTANCE` و `_VPC_CONNECTOR` لربط قاعدة البيانات و Redis.

### 6) النشر التلقائي (CI/CD)

```bash
# ربط مستودع Git بـ Trigger يبني وينشر عند كل push إلى main
gcloud builds triggers create github --repo-name=<REPO> --repo-owner=<OWNER> \
  --branch-pattern="^main$" --build-config=cloudbuild.yaml
```

### 7) التوسّع والمراقبة

- **التوسّع الأفقي:** `--max-instances` في Cloud Run؛ ولأن WebSocket يعمل عبر عدة نسخ، فإن **Socket.IO Redis Adapter مُفعّل تلقائيًا** (يحتاج Memorystore).
- **Load Balancer:** أضف HTTPS Load Balancer أمام Cloud Run مع session affinity لثبات اتصال WebSocket.
- **السجلات/المراقبة:** Cloud Logging و Cloud Monitoring يعملان تلقائيًا مع Cloud Run.

## النشر على VPS (بديل مختصر)

1. ثبّت Docker و docker-compose على الخادم.
2. ارفع المشروع (git clone أو scp).
3. `cp .env.example .env` ثم ضع أسرارًا قوية لـ JWT.
4. `docker compose up -d --build`.
5. `docker compose exec api npx prisma migrate deploy && docker compose exec api npm run seed`.
6. ضع Nginx كـ reverse proxy أمام المنفذ 4000 مع شهادة SSL (Let's Encrypt).

## ربط التطبيقين (الراكب والسائق)

- غيّر عنوان الـ API في التطبيقين إلى `https://<domain>/api`.
- التطبيقان يحتويان طبقة ربط جاهزة في `src/backend/` (REST + Socket.IO + JWT).

### خيار (أ) — جسر الهوية مع Firebase (المُوصى به)

التطبيقان يستخدمان Firebase Auth. بدل إدارة كلمة مرور ثانية، الخادم يتحقّق من رمز Firebase ID:

1. في Firebase Console → Project Settings → Service Accounts → Generate new private key.
2. ضع `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` في `.env`.
3. التطبيق بعد دخول Firebase يرسل `POST /api/auth/firebase { idToken }` → يُرجِع الخادم accessToken + refreshToken خاصّين به.
4. الخادم يُنشئ/يربط المستخدم في PostgreSQL (مطابقة بـ firebaseUid ثم البريد ثم الهاتف).
5. هذا التبادل مُفعّل تلقائيًا في التطبيقين (`loginWithFirebase` داخل initAuth).

### خيار (ب) — مصادقة الخادم مباشرة

- سجّل الدخول عبر `/api/auth/login` واحفظ accessToken + refreshToken.

### بعد المصادقة (لكلا الخيارين)

- يُفتح WebSocket تلقائيًا بـ `{ auth: { token: accessToken } }`.
- تطبيق السائق: يبثّ الموقع عبر `driver:location` (أُوقفت `enableLocalDriverSimulation`).
- تطبيق الراكب: يطلب الرحلة عبر `ride:request` ويتابع `driver:moved` / `trip:status`.
- الإشعارات: In-App عبر WebSocket (`notification`)؛ Push عبر FCM (ليس Firestore).

## خريطة الطريق (المراحل القادمة)

- [x] جسر الهوية: تحقّق الخادم من رمز Firebase ID (`/api/auth/firebase`) ✅
- [x] المطابقة التلقائية للسائق (عرض الرحلة مع مهلة) ✅ (المرحلة 4)
- [x] المدفوعات + المحفظة + عمليات السحب ✅ (المرحلة 3)
- [x] الكوبونات + التسعير حسب المدينة/الذروة ✅ (المرحلة 6)
- [x] الإشعارات (Push/SMS/Email/In-App) + الجدولة (Cron) ✅ (المرحلة 5)
- [x] الدعم الفني + الشكاوى + التقييمات ✅ (المرحلة 7)
- [x] التقارير (PDF/Excel) + الإحصائيات ✅ (المرحلة 8)
- [x] سجل النشاط (Audit/Activity) + صلاحيات الموظفين RBAC ✅ (المرحلة 9)
- [ ] **لوحة التحكم** (Next.js + Tailwind + Dark/Light + خريطة حية)
