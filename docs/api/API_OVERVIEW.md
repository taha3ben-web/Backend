# نظرة عامّة على الـ API

يصف هذا المستند السلوك المشترك لكل نقاط النهاية كما هو مضبوط فعليًّا في `src/main.ts`
والمكوّنات المشتركة. لجرد المسارات راجع [`endpoints.md`](./endpoints.md).

## البادئة والإصدار

- كل المسارات تحت البادئة `/api`.
- إصدار عبر المسار (URI Versioning) ببادئة `v`. الإصدار الافتراضي يشمل `1`
  والمحايد (VERSION_NEUTRAL) معًا؛ أي أنّ `GET /api/health` و`GET /api/v1/health` كلاهما يعمل
  (توافق خلفي — راجع ADR-0004).

## المصادقة

- رمز Bearer JWT في ترويسة `Authorization: Bearer <accessToken>`.
- تحمي المسارات حراسة `JwtAuthGuard` + `RolesGuard` + `PermissionsGuard`.
- رموز التحديث (Refresh Tokens) والجلسات (Sessions) تدير دورة حياة الدخول.
- الصلاحيات دقيقة عبر `@RequirePermissions("...")` (راجع ADR-0003).

## مغلّف الأخطاء الموحّد

كل الأخطاء تمرّ عبر `AllExceptionsFilter` وتُبنى بـ `buildErrorEnvelope`
(`src/common/api/api-error.util.ts`). يحمل المغلّف:

- `code`: كود خطأ **ثابت** (`ApiErrorCode`) يقرأه تطبيق الموبايل برمجيًّا.
- رسالة مترجمة حسب `Accept-Language`.
- `details` (اختياري): تفاصيل التحقّق من ValidationPipe.
- `path` و`requestId` و`traceId` للتتبّع.

يُرمى خطأ الأعمال عبر `throw new AppException("CODE", { details })`. في الإنتاج لا تُسرّب
رسائل أخطاء الخادم (5xx).

## الصفحات (Pagination)

من `PaginationDto` (`src/common/dto/pagination.dto.ts`):

- `page`: افتراضي `1` (أدنى 1).
- `limit`: افتراضي `20` (أقصى `100`).
- `search`: نص بحث اختياري.

## حدود المعدّل والحماية

- خنق (Throttling) عام: 120 طلبًا / 60 ثانية.
- ترويسات أمنية عبر `helmet`؛ حد حجم الجسم `1mb`.
- CORS من قائمة سماح `CORS_ORIGINS` (الإنتاج يمنع `*`).
- التوطين (Localization) عبر `Accept-Language`.

> ملاحظة: مخطّطات الطلب/الاستجابة لكل مسار موثّقة عبر DTOs (class-validator) في كل وحدة؛
> جرد المسارات المُولّد لا يستنتجها بعد (يُثرى مستقبلًا عبر @nestjs/swagger).
