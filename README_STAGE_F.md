# المرحلة و — أهلية السائق لنوع المركبة (الشرطان 2 و 6)

## 0. تصحيح لما قلتُه سابقًا

في تقرير الفحص الأول قلتُ إن `RequirementsService.verify()` **لا يُستدعى من أي مكان**. هذا خطأ مني. هو يُستدعى فعلًا في `vehicle-types.controller.ts:159`:

```ts
@Roles("STAFF")
@RequirePermissions("pricing.manage", "settings.manage")
@Get(":id/verify/:driverId")
```

فالخدمة موصولة وتعمل، والمشكلة ليست أنها مُعطّلة بل **من يستطيع الوصول إليها**.

## 1. ما كان موجودًا ولم يُعَد بناؤه

`RequirementsService.verify()` مكتمل وسليم، ويفحص من `VehicleType`: `minDriverRating`، `minDriverTrips`، `minVehicleYear`، `requiredLicenseType`، `requiredDocuments[]`، `requiredPhotos[]` — ويُرجع تقريرًا مفصّلًا `checks[]` مع `eligible`. **لم أكتب أي منطق فحص جديد، ولم ألمس هذا الملف.**

و`PATCH /driver/me` يتحقق أصلًا من ثلاثة قيود (المرحلة أ): المركبة المعتمدة لا تُعاد تصنيفها، والنوع يجب أن يكون `isActive` + `visibleToDrivers`، و`rideClass` يُشتق من النوع لا يرسله التطبيق. **لم أمسّ ذلك أيضًا.**

## 2. الفجوة الحقيقية

المسار الوحيد للفحص محجوز للموظفين، فـ**السائق لا يستطيع معرفة أهليته لنوع المركبة**. والشرط 2 يقول إن السائق يختار الفئة ثم النوع من الخادم، والشرط 6 يجعل هذا النوع محددًا للطلبات التي تصله تحديدًا صارمًا.

ولأن `PATCH /driver/me` لا يفحص المتطلبات إطلاقًا، كان المسار الواقعي للسائق هكذا: يختار نوعًا لا يستحقّه (مثلًا Comfort وسنة مركبته أقدم من `minVehicleYear`) → يرفع وثائقه → ينتظر أيامًا → يُرفض من اللوحة **بلا سبب مفهوم**. الخادم كان يعرف السبب من اللحظة الأولى، ولم يكن له أي طريقة لقوله للسائق.

## 3. التعديل (3 ملفات، بلا ترحيل)

**`driver-self.service.ts`** — حقن `RequirementsService` (نفس الخدمة، لا نسخة ثانية) + دالة `vehicleTypeEligibility(userId, vehicleTypeId)`.

**`driver-self.controller.ts`** — مسار `GET me/vehicle-types/:vehicleTypeId/eligibility`. معرف السائق يُشتق من التوكن ولا يأتي من المسار، فلا يستطيع سائق فحص ملف سائق آخر — بخلاف مسار اللوحة الذي يأخذ `:driverId` صراحةً.

**`drivers.module.ts`** — استيراد `VehicleTypesModule`. تحققتُ قبل ذلك أن `VehicleTypesModule` لا يستورد `DriversModule`، فلا استيراد دائري ولا حاجة لـ `forwardRef`. و`RequirementsService` مُصدَّر أصلًا من الوحدة.

## 4. أهم قرار في هذه المرحلة: لماذا لا أمنع الاختيار

الحل المغري كان ربط `PATCH /driver/me` بـ `eligible === true`. **وهذا كان سيعطّل التسجيل على كل سائق جديد.**

السبب: فحوص المستندات في `verify()` تشترط `status === "APPROVED"`، ولا وثيقة واحدة تكون معتمدة قبل مراجعة اللوحة. فتنشأ دورة مغلقة:

> السائق يحتاج اختيار النوع لـ**يعرف** الوثائق المطلوبة (المرحلة ج: `documentRequirements`)، ويحتاج وثائق معتمدة ليـ**يأخذ** النوع.

وهذا نفس الفخ الذي رفضتُه في المرحلة ج حين قررت أن فرض الوثائق عند كل رفع خطأ. لذلك تفصل الدالة الفحوص إلى مجموعتين:

| المجموعة | الفحوص | المعنى |
| --- | --- | --- |
| `blocking` | `minDriverRating`, `minDriverTrips`, `minVehicleYear` | موضوعية ولا تعتمد على موافقة أحد. رفع الوثائق لن يغيرها. |
| مستندية | `document:*`, `photo:*`, `requiredLicenseType` | خطوات متبقية، لا رفض. تُراجع لاحقًا. |

ولأن `verify()` يعرف `APPROVED` وحدها ولا يميّز بين «لم تُرفع» و«مرفوعة تنتظر»، تقرأ الدالة حالات وثائق السائق وتفصل المستندي إلى: `missingDocuments` (لا وجود لها)، `awaitingApproval` (مرفوعة `PENDING`)، `actionRequired` (مرفوضة أو منتهية وتحتاج إعادة رفع). هذا الفرق هو الفرق بين «ارفع وثيقة» و«انتظر» و«أعد الرفع» في واجهة السائق.

**البوّابة الحقيقية لم تتغير:** `setAvailability(ONLINE)` يشترط `status === "APPROVED"`، والاعتماد النهائي للوحة عبر `PATCH /vehicles/:id/verify`. هذا المسار يقرأ ولا يكتب ولا يعتمد أحدًا.

## 5. عقد المسار

```
GET /api/driver/me/vehicle-types/:vehicleTypeId/eligibility     (DRIVER)
```

```json
{
  "vehicleTypeId": "...",
  "vehicleTypeName": "Comfort",
  "vehicleTypeNameI18n": { "ar": "...", "fr": "...", "en": "..." },
  "rideClass": "COMFORT",
  "eligible": false,
  "selectable": true,
  "checks": [
    {
      "key": "minVehicleYear",
      "label": "الحد الأدنى لسنة الصنع",
      "required": 2015,
      "actual": 2012,
      "ok": false
    }
  ],
  "blocking": [],
  "awaitingApproval": ["LICENSE"],
  "actionRequired": [],
  "missingDocuments": ["TECHNICAL_INSPECTION"]
}
```

ملاحقات للتطبيق:

- `selectable` هو المعيار لتعطيل بطاقة النوع، لا `eligible`. استعمال `eligible` للتعطيل يمنع كل سائق جديد من التسجيل.
- `blocking` هي الوحيدة التي تستحق رسالة «لا تستطيع اختيار هذا النوع»، وفيها `required` و`actual` لإظهار السبب رقمًا.
- `label` في `checks` عربي من الخادم (داخل `requirements.service.ts` القائم). للواجهة بثلاث لغات استعمل `key` مع i18n عندك، ولا تعرض `label` خامًا في واجهة فرنسية.
- أسماء الوثائق في `missingDocuments`/`awaitingApproval`/`actionRequired` مفاتيح `DocumentType`، تُترجم في التطبيق عبر i18n.

## 6. حدود معروفة (لم أدّعِ حلّها)

- لا يوجد مسار يُرجع أهلية **كل الأنواع دفعة واحدة**؛ التطبيق يسأل عن النوع المرشّح. لم أضف مسار جملة لأن `verify()` ينفّذ استعلامين لكل نوع (N+1)، وتحسينه يعني تعديل خدمة تعتمد عليها اللوحة فعلًا. إن احتاجته شاشة اختيار النوع فهو مرحلة مستقلة مع دفعة واحدة.
- `minDriverTrips` يقرأ `Driver.totalTrips`، وهو يُزامن بالإسناد لا بالزيادة في `profile-levels`؛ وهو سلوك قائم لم أغيره.

## 7. الاختبار — لم يُشغَّل

**لم يُشغَّل `npm run build` ولا `tsc` ولا `npx prisma generate`** (لا `node_modules` ولا شبكة؛ و`npx tsc` يفشل بـ `error TS5102: Option 'baseUrl' has been removed`).

ما تحقّق فعلًا:

- `prettier` حلّل الملفات الثلاثة بنجاح؛ `drivers.module.ts` نطيف تمامًا.
- `prettier` أشار أول مرة إلى سطر واحد **في كودي المضاف** (`const docType = ...` طويل)، فأصلحتُه يدويًا بنفس صياغة prettier وأعدت التحقق: لم يبق أي سطر من المرحلة و في فرق prettier.
- التحذيرات المتبقية في `driver-self.service.ts` و`driver-self.controller.ts` **كلها في كود سابق لم ألمسه** (`resetVerification`، `trip()`، `updateTripStatus()`، `availability`، `trip`/`updateTrip`)، ولم أشغّل `--write`.
- تأكيد عدم الاستيراد الدائري بقراءة `vehicle-types.module.ts` كاملًا.

يبقى الخطر الوحيد غير المثبَت: أن يرفض Nest حقن `RequirementsService` لسبب إعداد لم أره. **شغّل `npm run build` وإن فشل فأخبرني بنص الخطأ.**

## 8. الترحيل

**لا تعديل على `schema.prisma`، ولا حاجة إلى `prisma migrate`.** المسار قراءة فقط.
