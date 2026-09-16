/** ترجمة أخطاء Prisma المعروفة إلى أخطاء نطاق متوقعة. */
import { AppException } from "./app.exception";

/** الفهرس الجزئي authoritative المعرّف في hardening. */
export const ACTIVE_TRIP_UNIQUE_INDEX =
  "Trip_one_active_per_passenger_idx";

interface PrismaLikeError {
  code?: unknown;
  message?: unknown;
  meta?: unknown;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as PrismaLikeError).code === "P2002",
  );
}

/** يطابق اسم constraint صريحًا في رسالة Prisma أو metadata. */
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
 * بعض إصدارات Prisma تعيد الفهرس الخام باسمه، وأخرى تعيد modelName مع
 * target columns. نقبل الشكل الثاني فقط إذا كان النموذج Trip والهدف الوحيد
 * passengerId؛ لا تكفي كلمة passengerId وحدها كي لا نلتقط constraint آخر.
 */
function isStructuredTripPassengerTarget(error: unknown): boolean {
  if (!isUniqueConstraintError(error)) return false;
  const meta = (error as PrismaLikeError).meta;
  if (!meta || typeof meta !== "object") return false;
  const value = meta as { modelName?: unknown; target?: unknown };
  return (
    value.modelName === "Trip" &&
    Array.isArray(value.target) &&
    value.target.length === 1 &&
    value.target[0] === "passengerId"
  );
}

export const ACTIVE_TRIP_UNIQUE_TARGETS = [ACTIVE_TRIP_UNIQUE_INDEX] as const;

export function rethrowAsActiveTripConflict(
  error: unknown,
  details?: Record<string, unknown>,
): never {
  const matched =
    ACTIVE_TRIP_UNIQUE_TARGETS.some((target) =>
      isUniqueConstraintOn(error, target),
    ) || isStructuredTripPassengerTarget(error);
  if (matched) {
    throw new AppException("ACTIVE_TRIP_EXISTS", {
      details: { ...details, reason: "concurrent_request_lost_db_constraint" },
    });
  }
  throw error;
}
