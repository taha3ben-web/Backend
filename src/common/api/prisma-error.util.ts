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
 * قاعدة البيانات. مُعرَّف في مايغريشن
 * 20260910060000_trip_active_passenger_uniqueness ولا يمكن التعبير عنه
 * في schema.prisma، لذلك الاسم مركزي هنا بدل تكراره نصًّا في كل مسار.
 */
export const ACTIVE_TRIP_UNIQUE_INDEX =
  "Trip_one_active_per_passenger_idx";

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
 * الفهرس الجزئي غير ممثل في Prisma schema، لذلك نطابق اسمه الصريح فقط
 * في meta أو الرسالة. لا نطابق passengerId وحده، لأن ذلك قد يحوّل قيدًا
 * مختلفًا مستقبلًا إلى ACTIVE_TRIP_EXISTS عن طريق الخطأ.
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
 * يحوّل فقط خرق فهرس «الرحلة الفورية الواحدة» المعروف إلى
 * ACTIVE_TRIP_EXISTS. أي P2002 آخر يُعاد رميه كما هو.
 */
export const ACTIVE_TRIP_UNIQUE_TARGETS = [ACTIVE_TRIP_UNIQUE_INDEX] as const;

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
