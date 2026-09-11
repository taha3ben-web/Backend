/**
 * ترجمة أخطاء Prisma المعروفة إلى أخطاء نطاق (AppException) — طبقة نقية.
 *
 * لماذا: خرق قيد تفرّد في قاعدة البيانات هو **نتيجة تجارية متوقّعة** في
 * المسارات المتزامنة، لا خطأ خادم. تركه يصعد يعني HTTP 500 ورسالة Prisma
 * خام تظهر في تطبيق الراكب. هذه الطبقة تحوّله إلى كود موحّد مترجم
 * (`ACTIVE_TRIP_EXISTS` → «لديك رحلة نشطة بالفعل.») يقرأه التطبيق برمجيًا.
 *
 * بلا اعتماد على NestJS أو Prisma Client في التوقيع، فهي قابلة لاختبار
 * الوحدة بكائنات خطأ مُصطنعة.
 */

import { AppException } from "./app.exception";

/**
 * اسم الفهرس الجزئي الفريد الذي يفرض «رحلة فورية واحدة لكل راكب» في
 * قاعدة البيانات. مُعرَّف في مايغريشن 20260912090100 ولا يمكن التعبير عنه
 * في schema.prisma، لذلك الاسم مركزي هنا بدل تكراره نصًّا في كل مسار.
 */
export const ACTIVE_TRIP_UNIQUE_INDEX = "Trip_active_passenger_unique";

interface PrismaLikeError {
  code?: unknown;
  message?: unknown;
  meta?: unknown;
}

/** هل هذا خطأ خرق قيد تفرّد (P2002)؟ */
export function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as PrismaLikeError).code === "P2002";
}

/**
 * هل خرق التفرّد يتعلّق بالقيد المذكور؟
 *
 * Prisma يضع اسم الهدف في `meta.target` كمصفوفة أعمدة للقيود المعروفة في
 * المخطط، وكاسم الفهرس نصًّا للفهارس المُعرّفة في القاعدة فقط (حالتنا).
 * نفحص التمثيل النصي للـmeta وللرسالة معًا حتى لا نعتمد على شكل واحد
 * قد يتغيّر بين إصدارات Prisma.
 */
export function isUniqueConstraintOn(error: unknown, target: string): boolean {
  if (!isUniqueConstraintError(error)) return false;
  const err = error as PrismaLikeError;
  const haystacks: string[] = [];
  if (typeof err.message === "string") haystacks.push(err.message);
  if (err.meta !== undefined) {
    try {
      haystacks.push(JSON.stringify(err.meta));
    } catch {
      haystacks.push(String(err.meta));
    }
  }
  return haystacks.some((value) => value.includes(target));
}

/**
 * يحوّل خرق قيد «الرحلة الفورية الواحدة» إلى `ACTIVE_TRIP_EXISTS`.
 *
 * يُستدعى في كل مسار قد يُنشئ رحلة فورية (طلب رحلة، قبول عرض سعر). أي خطأ
 * آخر يُعاد رميه كما هو دون تغيير سلوك أو إخفاء سبب.
 *
 * لماذا نقبل شكلين للهدف: خطأ PostgreSQL الأصلي يقول
 * `duplicate key value violates unique constraint "Trip_active_passenger_unique"`،
 * لكن Prisma قد يُعيد صياغته إلى `meta.target` كاسم القيد أو كقائمة أعمدة
 * (`passengerId`) حسب الإصدار. لا يوجد أي قيد تفرّد آخر على `Trip` يشمل
 * `passengerId`، فمطابقة أيّ الشكلين آمنة ولا تخطئ في تصنيف خطأ آخر
 * (مثل خرق `CouponRedemption.tripId` الذي يظهر بهدف `tripId`).
 */
export const ACTIVE_TRIP_UNIQUE_TARGETS = [
  ACTIVE_TRIP_UNIQUE_INDEX,
  "passengerId",
] as const;

export function rethrowAsActiveTripConflict(
  error: unknown,
  details?: Record<string, unknown>,
): never {
  const matched = ACTIVE_TRIP_UNIQUE_TARGETS.some((target) =>
    isUniqueConstraintOn(error, target),
  );
  if (matched) {
    throw new AppException("ACTIVE_TRIP_EXISTS", {
      details: { ...details, reason: "concurrent_request_lost_db_constraint" },
    });
  }
  throw error;
}
