# المرحلة د — الطبقات والترقية (Backend فقط)

هذه المرحلة تُكمل **الشرط 10** (الطبقات والترقية والصدارة) على الخادم وحده. لم يُلمس أي ملف في تطبيق السائق.

---

## 1. ما كان موجودًا فعلًا (ولم يُعَد بناؤه)

قبل أي تعديل، فُحص النظامان القائمان:

| الموجود | المكان | الحكم |
|---|---|---|
| طبقات السائق `BRONZE/SILVER/GOLD/DIAMOND/LEGENDARY` من عدد الرحلات المكتملة (0/10/50/100/500) | `src/modules/profile-levels/profile-level.util.ts` | **هذا هو نظام طبقات السائق الحقيقي.** استُعمل كما هو. |
| حساب المستوى + الإطار + البثّ اللحظي `profile:level` | `profile-levels.service.ts` | يعمل. **لم يُعدَّل إطلاقًا.** |
| `GET /api/driver/leaderboard` مع `rank` و`me` و`isMe` و`localBasis` | `driver-self.service.ts` | الترتيب **موجود ومكتمل**. لم يُبنَ من جديد. |
| نظام نقاط الولاء `BRONZE/SILVER/GOLD/PLATINUM` (1000/5000/20000 نقطة) | `src/modules/loyalty/` | **نظام مختلف تمامًا.** لم يُدمَج ولم يُحذف. انظر القسم 4. |

لا جدول Prisma جديد، ولا ترحيل، ولا نظام طبقات ثانٍ.

---

## 2. الفجوة الحقيقية التي عالجتها هذه المرحلة

مستوى السائق كان يُرجَع **داخل `GET /driver/me` وحده**: الطبقة الحالية فقط.

الخادم لم يكشف في أي مكان:

- **سلّم الطبقات** (الطبقات الخمس وعتباتها)
- **المزايا** لكل طبقة
- **نسبة التقدّم** داخل الطبقة الحالية

ونتيجة ذلك أن شاشة الطبقات كانت غير قابلة للبناء إلا بكتابة الأرقام `0/10/50/100/500` داخل التطبيق — وهو ما يخالف شرطك «الطبقات من الخادم لا أرقام وهمية في التطبيق»، ويخالف أيضًا تحذيرًا مكتوبًا أصلًا في أعلى `profile-level.util.ts`:

> «لا تُنسخ إلى PassengerApp أو DriverApp أو لوحة التحكم إطلاقًا».

أي أن الملف نفسه كان يمنع الحل الوحيد المتاح للتطبيق. هذه المرحلة تُزيل التناقض.

---

## 3. التعديلات (٣ ملفات)

### `src/modules/profile-levels/profile-level.util.ts` (إضافة في النهاية فقط)

لم يُعدَّل أي سطر قائم. أُضيف:

- `ProfileLevelBenefit` — ميزة واحدة بـ `key` ثابت + نص `ar` / `fr` / `en` (اللغات الثلاث، لأن التطبيق ممنوع من كتابة نصوص ثابتة).
- `PROFILE_LEVEL_COMMON_BENEFITS` — مزايا مشتركة تُعرض مرة واحدة بلا تكرار في كل درجة.
- `PROFILE_LEVEL_BENEFITS` — مزايا كل طبقة.
- `profileLevelLadder(count)` — السلّم كاملًا: `level`, `minCompletedTrips`, `frameKey`, `benefits`, `isCurrent`, `isReached`, `tripsRemaining`.
- `profileLevelProgressPercent(count)` — نسبة 0–100 داخل الطبقة الحالية، وتُرجع `100` عند أعلى طبقة (لا شريط فارغ لأسطوري).

العتبات لم تُنسخ: `profileLevelLadder` تقرأ `PROFILE_LEVEL_THRESHOLDS` القائم. المصدر ما زال واحدًا.

### `src/modules/drivers/driver-self.service.ts`

- استيراد الدوال الثلاث من `profile-level.util`.
- دالة `tier(userId)` جديدة قبل `setAvailability`.

تبني الرد من `ProfileLevelsService.forDriver()` القائم + `profileLevelLadder`. روابط الإطارات تُولَّد هنا عبر `StorageService.resolveStoredUrl` لأن الـ util نقيّ ولا يعرف R2.

### `src/modules/drivers/driver-self.controller.ts`

مسار واحد: `@Get("me/tier")` — محمي بـ `JwtAuthGuard + RolesGuard` و`@Roles("DRIVER")` الموروثين من الـ controller.

---

## 4. قرارات مقصودة — اقرأها قبل ربط التطبيق

### أ) المزايا محصورة في ما ينفّذه الخادم فعلًا

فحصتُ `matching-engine.service.ts`: التوزيع يتم بـ **نوع المركبة والمسافة فقط**. لا توجد أولوية للطبقة، ولا حسم عمولة مرتبط بالطبقات في أي مكان في الكود.

لذلك المزايا المكشوفة الآن محصورة في الحقيقي والقابل للتحقق:

- **الإطار** حول الصورة — حقيقي، الراكب يراه في بطاقة الرحلة.
- **الظهور في الصدارة** — حقيقي، `/driver/leaderboard` يعمل.

**لم أكتب «أولوية في الطلبات» ولا «حسم عمولة» ولا «مكافأة».** إظهار وعد لا ينفّذه الخادم للسائق كذب في واجهة المستخدم، لا ميزة. أي ميزة تجارية يجب أن تُنفَّذ في الخادم أولًا ثم تُضاف إلى `PROFILE_LEVEL_BENEFITS`.

### ب) المزايا ليست قابلة للتحرير من اللوحة بعد

مصدرها الآن ثابت في الخادم (نقطة واحدة، ليست في التطبيق). جعلها قابلة للتحرير من اللوحة يحتاج جدول Prisma + CRUD + ترحيل. **لم أفعل ذلك** لأنك لم تطلب إدارة المزايا من اللوحة (طلبتها للشروط والخصوصية في الشرط 11)، ولا أضيف جدولًا لم يُطلب. إن أردته لاحقًا فهو تعديل مستقل نظيف: التطبيق يعرض ما يرسله الخادم، فلن يتغيّر التطبيق.

### ج) الترتيب لم يُكرَّر في `/me/tier`

`/driver/leaderboard` يُرجع `me.rank` أصلًا. تكراره في `/me/tier` يعني استعلام ١٠٠٠ سائق مرتين لنفس الشاشة. الشاشة تستدعي المسارين معًا.

### د) تعارض أسماء خطير بين نظامين — يجب أن يعرفه التطبيق

`GET /api/loyalty/me` محميّ بـ `JwtAuthGuard` **فقط، بلا قيد دور**. أي أن **توكن السائق يستطيع استدعاءه**، فيحصل على:

- `/driver/me/tier` → `GOLD` تعني **50 رحلة**
- `/api/loyalty/me` → `GOLD` تعني **5000 نقطة**

اسمان متطابقان لنظامين مختلفين يصلهما نفس التوكن، ونظام الولاء فيه `PLATINUM` التي لا وجود لها في طبقات السائق. لذلك يُرجع `/me/tier` الحقل `system: "PROFILE_LEVELS"` صراحةً.

**على تطبيق السائق ألّا يستدعي `/api/loyalty/me` لشاشة الطبقات إطلاقًا.** لم أدمج النظامين ولم أحذف أحدهما لأن نظام الولاء مرتبط بالمحفظة والاستبدال، وهذا قرار منتج لا تنظيف كود.

---

## 5. عقد الواجهة الجديد

```
GET /api/driver/me/tier        (DRIVER)
```

```jsonc
{
  "system": "PROFILE_LEVELS",
  "completedTripsCount": 37,
  "profileLevel": "SILVER",
  "profileFrameUrl": "https://.../profile-frames/silver.svg",
  "nextLevel": "GOLD",
  "nextLevelAt": 50,
  "tripsToNextLevel": 13,
  "progressPercent": 68,
  "commonBenefits": [
    { "key": "leaderboard", "ar": "...", "fr": "...", "en": "..." }
  ],
  "ladder": [
    {
      "level": "BRONZE",
      "minCompletedTrips": 0,
      "frameUrl": "https://.../profile-frames/bronze.svg",
      "benefits": [{ "key": "frame", "ar": "...", "fr": "...", "en": "..." }],
      "isCurrent": false,
      "isReached": true,
      "tripsRemaining": 0
    }
    // ... SILVER, GOLD, DIAMOND, LEGENDARY
  ]
}
```

ملاحظات للتطبيق:

- `progressPercent` و`tripsToNextLevel` جاهزان — لا يُحسبان في التطبيق.
- `ladder` مرتّب من الأدنى إلى الأعلى دائمًا؛ لا يُعاد ترتيبه في التطبيق.
- نصوص المزايا تُختار بلغة الواجهة الحالية من `ar`/`fr`/`en` ولا تُكتب في ملفات i18n.
- `frameUrl` قد يكون `null` إن لم يُهيَّأ التخزين؛ يجب التعامل مع ذلك بلا انهيار.

---

## 6. الاختبار — لم يُشغَّل

**لم يُشغَّل `npm run build` ولا `tsc` ولا `npx prisma generate`.** السبب نفسه المسجَّل في `README_STAGE_A.md` و`README_STAGE_B.md` و`README_STAGE_C.md`:

- `node_modules` غير موجود في الأرشيف ولا شبكة لتنزيل الحزم.
- `npx tsc` يفشل قبل الوصول إلى الكود بخطأ إعداد لا علاقة له بالتعديلات:
  `error TS5102: Option 'baseUrl' has been removed`.

**ما تحقّق فعلًا:**

- `prettier` حلّل الملفات الثلاثة بنجاح ⇒ لا خطأ صياغة.
- فرق `prettier` أُسند سطرًا بسطر: كل الملاحظات واقعة في كود **سابق** لم يُلمس (`describeProfileLevel` ‏93، `availability` ‏45، `trip`/`updateTrip` ‏93+، `resetVerification` ‏478، `trip`/`updateTripStatus` ‏783+). الكود المضاف (util ‏118–238، `tier()` ‏651–694، المسار ‏76) لا يظهر في أي فرق. لم يُشغَّل `--write` لئلا يُخلط ضجيج تنسيق بعمل المرحلة.
- تحقُّق من وجود كل ما استُعمل: `PROFILE_LEVEL_THRESHOLDS`, `PROFILE_LEVELS`, `getProfileLevel`, `nextProfileLevel`, `profileFrameObjectKey`, `normalizeCount`, `ProfileLevelsService.forDriver`, `StorageService.resolveStoredUrl`, `STORED_MEDIA_READ_TTL_MINUTES`, `requireDriver`.

**شغّل `npm run build` عندك قبل الاعتماد على المرحلة.**

---

## 7. لا ترحيل قاعدة بيانات

لا تغيير في `schema.prisma`. لا `prisma migrate`. النشر = بناء وإعادة تشغيل فقط.
