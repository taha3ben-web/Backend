# تعديلات الخادم — المرحلة أ (ربط ما بنيناه في تطبيق السائق)

انسخ ملفات هذه الحزمة فوق مثيلاتها في `Backend-main` بنفس المسارات، ثم:

```bash
npx prisma migrate deploy   # أو: npx prisma migrate dev
npx prisma generate
npm run build
```

---

## 1) التفاوض على السعر يصل للسائق
**`src/modules/matching/matching.service.ts`**

حدث `ride:offer` أصبح يحمل: `fareQuoteId`, `negotiable`, `negotiationMin`, `negotiationMax`
(من `FareQuote` + `VehicleType.allowsNegotiation` + `VehiclePricingRule.negotiationMin/Max`).

قبل هذا كانت لوحة المساومة في بطاقة الطلب معطّلة دائمًا لأن `fareQuoteId` غير موجود، فلا يمكن
استدعاء `POST /api/driver/fare-offers`. فشل تحميل معطيات التفاوض يُسجّل تحذيرًا فقط ولا يمنع
وصول الطلب.

## 2) نوع المركبة يختاره السائق في شاشة الوثائق
**`src/modules/drivers/dto/driver-self.dto.ts` + `driver-self.service.ts`**

`PATCH /api/driver/me` يقبل الآن `vehicleTypeId` بثلاثة قيود:

- مركبة معتمدة (APPROVED) لا تُعاد تصنيفها من التطبيق → 400 مع رسالة عربية.
- النوع يجب أن يكون `isActive` و`visibleToDrivers` (يُدار من لوحة التحكم).
- `rideClass` تُشتق من النوع نفسه، التطبيق لا يرسلها.
- أي تغيير للنوع يُرجع المركبة إلى `PENDING` للمراجعة.

كان الحقل يُرفض بـ 400 بسبب `forbidNonWhitelisted`، فكان اختيار السائق (سيارة/دراجة نارية،
اقتصادية/confort/نسائية) يبقى محليًا ولا يصل الخادم — أي أن التوجيه حسب النوع كان مستحيلًا.

## 3) صدارة السائقين
**`driver-self.controller.ts` + `driver-self.service.ts`**

`GET /api/driver/leaderboard?scope=city|country&limit=20`

- السائقون المعتمدون فقط، والترتيب من الرحلات المكتملة فعليًا (`Trip.status = COMPLETED`)
  وليس من عدّاد `totalTrips`، وهو نفس مصدر مستويات الملف فلا يرى السائق رقمين متعارضين.
- الرتبة تُحسب على القائمة الكاملة قبل الاقتطاع، و`me` تُرجع رتبة السائق الحقيقية حتى لو كان
  خارج القائمة المعروضة.
- التعادل يُفصل بالتقييم ثم بالمعرّف لترتيب ثابت.
- سائق بلا مدينة يُرجع `available: false` بدل قائمة مضلّلة.
- الشكل مطابق لعقد `loyalty.api.ts` في التطبيق: `{scope, period, available, total, rows[], me}`
  و`rows[] = {rank, driverId, name, photoUrl, cityName, score, scoreUnit, rating, isMe}`.

شاشة الطبقات في التطبيق كانت تعرض حالة فارغة دائمًا لأن هذه النقطة لم تكن موجودة.

## 4) وثائق السائق: النوعان الناقصان + التواريخ
**`prisma/schema.prisma` + الترحيل + `dto/driver-self.dto.ts` + `driver-self.service.ts`**

- `DocumentType` += `CARTE_GRISE`, `TECHNICAL_INSPECTION` (التطبيق يرفعهما فعليًا وكانا يُردّان بـ 400).
  `REGISTRATION` يبقى للسجلات القديمة.
- `DocumentStatus` += `EXPIRED`.
- `DriverDocument.issuedAt` عمود جديد (`expiresAt` كان موجودًا لكن لا يُكتب).
- `POST /api/driver/me/documents` يحفظ `issuedAt` و`expiresAt`.
- `GET /api/driver/me` يعرض `issuedAt`/`expiresAt`/`note`، ويعرض `EXPIRED` لوثيقة معتمدة
  انتهت مدتها دون تغيير المخزّن.
- `REQUIRED_DRIVER_DOC_TYPES` صُدّرت من الخادم لتطابق التطبيق
  (رخصة + بطاقة رمادية + فحص تقني + تأمين). القائمة النهائية لكل نوع مركبة تبقى من لوحة التحكم.

---

## لم يُنفّذ بعد (المراحل التالية)

- **التوجيه الصارم حسب النوع**: في `matching-engine.service.ts` يوجد احتياط
  `if (ctx.vehicleTypeId && eligible.length === 0)` يعيد الاستعلام بـ `rideClass` وحده،
  فطلب "دراجة" قد يصل لسيارة. يحتاج قرارك: نحذف الاحتياط أم نجعله راية تُضبط من اللوحة.
- المحفظة والسحب والتحويلات، الإشعارات، الإكراميات، الإحالات، الحوافز، مناطق الطلب والخريطة
  الحرارية، KYC، المفقودات، إصدارات التطبيق، بلوكات المحتوى.
- لوحة التحكم عندما ترسلها: أنواع المركبات وفئات الدراجات، الوثائق المطلوبة لكل نوع،
  الشروط وسياسة الخصوصية، طبقات السائقين.

## تنبيه
لم أتمكن من تشغيل `tsc` هنا: `tsconfig.json` يستخدم `baseUrl` الذي أزالته نسخة TypeScript
المثبّتة في هذه البيئة (`error TS5102`) — مشكلة بيئة لا علاقة لها بتعديلاتي. شغّل `npm run build`
عندك للتأكيد.
