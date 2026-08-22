# المرحلة ب — تعديلات الخادم

انسخ الملفات فوق مشروع الخادم (نفس المسارات)، ثم:

```
npx prisma migrate deploy
npx prisma generate
npm run build
```

## ما تغير

1. **توجيه صارم حسب النوع** — `matching/engine/matching-engine.service.ts`
   حُذف التراجع إلى `rideClass` وحده. طلب دراجة لن يصل لسيارة أبدًا،
   وطلب "نسائية" لن يصل لغير هذا النوع.
   ⚠️ **مركبة بلا `vehicleTypeId` لن ترى أي طلب موجّه** — يجب ربط المركبات
   القديمة بأنواع الكتالوج من لوحة التحكم (`PATCH /vehicles/:id/reclassify`).

2. **`GET /api/rides/availability?lat&lng&radiusKm`** (جديد) — الأنواع المتوفرة فعلًا
   حول الراكب (سائقون APPROVED + ONLINE داخل نفس نطاق المطابقة من Redis GEO).
   يُرجع: `availableVehicleTypeIds`، `countByVehicleTypeId`، `countByRideClass`،
   `onlineNearby`، `radiusKm`. قائمة فارغة = لا توفر (أو Redis معطّل — اعرض
   الكتالوج كاملًا في هذه الحالة بدل حجب كل شيء).
   ملاحزة: لا يستبعد المشغولين برحلة عمدًا.

3. **الولاية وحدها عند التسجيل**
   - `Driver.wilayaId` جديد (+ فهرس ومفتاح أجنبي). `cityId` يبقى للتوافق وللتسعير.
   - `PATCH /api/driver/me` يقبل `wilayaId`.
   - `GET /api/driver/me` يُرجع `wilayaId` و`wilaya {id, number, nameAr, nameFr}`.
   - `GET /api/geography/public/resolve-wilaya?lat&lng` (جديد) لزر "تحديد تلقائي".
     يُرجع `{match, distanceKm, confidence}`. الترجيح بأقرب مركز ولاية لأن المخطط
     لا يحمل حدودًا جغرافية — `confidence: high` ثبّتها، وغير ذلك اعرضها كاقتراح.
   - لعرض كل الولايات المضافة من اللوحة: `GET /api/geography/public/wilayas?all=true`
     (بدون `all=true` تعود مناطق التشغيل فقط). الترتيب برقم الولاية — نفس ترتيب اللوحة.

4. **الصورة الشخصية تتغير فورًا** — `PATCH /api/driver/me` يقبل `photoUrl` ويكتبه
   مباشرة على `User.avatarUrl` بلا موافقة من اللوحة. مراجعة وثائق الهوية
   والمركبة لم تتغير. التدفق: `POST /driver/me/upload-url` → رفع →
   `PATCH /driver/me { photoUrl: objectPath }`.

5. **الصورة الأمامية للمركبة مكان رخصة VTC** — `DocumentType` أصبح فيه
   `VEHICLE_FRONT_PHOTO` (مقبول في `POST /driver/me/documents`).

## ملفات الترحيل

`prisma/migrations/20260822030000_driver_app_stage_b/migration.sql` — إضافي بالكامل:
قيمة enum جديدة، عمود `wilayaId`، فهرس، مفتاح أجنبي، وتعبئة `wilayaId`
للسائقين الحاليين من مدينتهم. لا حذف ولا تغيير لأي عمود قائم.

## غير مختبر محليًا

لم أستطع تشغيل `tsc` هنا: `tsconfig.json` يستخدم `baseUrl` المحذوف في نسخة
 TypeScript في هذه البيئة (TS5102) — خلل بيئة لا علاقة له بالتعديلات.
أكّد بالبناء عندك بعد `prisma generate`.

## ما يلزم من لوحة التحكم (لا يزال ناقصًا)

- أيقونة/صورة لكل نوع مركبة تُرفع من اللوحة وتظهر في بطاقة النوع
  (حاليًا `imageAssetKey` يُشتق من `rideClass` فقط عبر الإعداد `passenger.vehicleAssetKeys`).
- ربط المركبات القديمة بأنواع الكتالوج (إلزامي بعد التوجيه الصارم).
- ترجمة أسماء الأنواع للفرنسية والإنجليزية (التطبيق أصبح بثلاث لغات).
