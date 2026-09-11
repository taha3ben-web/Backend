import {
  ACTIVE_TRIP_UNIQUE_INDEX,
  isUniqueConstraintError,
  isUniqueConstraintOn,
  rethrowAsActiveTripConflict,
} from "./prisma-error.util";
import { AppException } from "./app.exception";
import { httpStatusForCode, translateCode } from "./api-error.util";

/** خطأ P2002 كما يُنتجه Prisma لفهرس مُعرَّف في قاعدة البيانات فقط. */
const p2002 = (target: unknown) =>
  Object.assign(
    new Error(
      `\nInvalid \`prisma.trip.create()\` invocation:\n\nUnique constraint failed on the fields: (\`${String(target)}\`)`,
    ),
    { code: "P2002", meta: { target } },
  );

describe("Prisma unique violation → domain error (never HTTP 500)", () => {
  it("recognizes P2002 only", () => {
    expect(isUniqueConstraintError(p2002(ACTIVE_TRIP_UNIQUE_INDEX))).toBe(true);
    expect(
      isUniqueConstraintError(Object.assign(new Error("x"), { code: "P2025" })),
    ).toBe(false);
    expect(isUniqueConstraintError(new Error("plain"))).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
  });

  it("matches the index name whether Prisma reports it in meta or in the message", () => {
    // شكل الفهرس المُعرَّف في القاعدة فقط: الاسم نصًّا.
    expect(
      isUniqueConstraintOn(
        p2002(ACTIVE_TRIP_UNIQUE_INDEX),
        ACTIVE_TRIP_UNIQUE_INDEX,
      ),
    ).toBe(true);
    // شكل مصفوفة الأعمدة (قيود المخطط) — لا يطابق اسم فهرسنا.
    expect(
      isUniqueConstraintOn(p2002(["passengerId"]), ACTIVE_TRIP_UNIQUE_INDEX),
    ).toBe(false);
    // اسم موجود في الرسالة فقط.
    const messageOnly = Object.assign(
      new Error(
        `Unique constraint failed on the constraint: \`${ACTIVE_TRIP_UNIQUE_INDEX}\``,
      ),
      { code: "P2002" },
    );
    expect(
      isUniqueConstraintOn(messageOnly, ACTIVE_TRIP_UNIQUE_INDEX),
    ).toBe(true);
  });

  it("maps the losing concurrent ride request to ACTIVE_TRIP_EXISTS (409)", () => {
    let caught: unknown;
    try {
      rethrowAsActiveTripConflict(p2002(ACTIVE_TRIP_UNIQUE_INDEX), {
        passengerId: "p-1",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppException);
    const app = caught as AppException;
    expect(app.code).toBe("ACTIVE_TRIP_EXISTS");
    expect(app.getStatus()).toBe(409);
    expect(httpStatusForCode("ACTIVE_TRIP_EXISTS")).toBe(409);
    // رسالة نطاق مترجمة، لا نص Prisma خام.
    expect(translateCode("ACTIVE_TRIP_EXISTS", "en")).toBe(
      "You already have an active trip.",
    );
    expect(app.details).toMatchObject({ passengerId: "p-1" });
  });

  it("maps both shapes Prisma may report for a DB-level index", () => {
    // شكل 1: اسم القيد (كما في رسالة PostgreSQL الأصلية).
    expect(() =>
      rethrowAsActiveTripConflict(p2002(ACTIVE_TRIP_UNIQUE_INDEX)),
    ).toThrow(AppException);
    // شكل 2: قائمة الأعمدة — لا يوجد قيد تفرّد آخر على Trip يشمل
    // passengerId، فالمطابقة آمنة.
    expect(() => rethrowAsActiveTripConflict(p2002(["passengerId"]))).toThrow(
      AppException,
    );
    // شكل 3: الرسالة الخام من PostgreSQL كما تصل عبر Prisma.
    const pgStyle = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "Trip_active_passenger_unique"',
      ),
      { code: "P2002" },
    );
    expect(() => rethrowAsActiveTripConflict(pgStyle)).toThrow(AppException);
  });

  it("never swallows unrelated errors", () => {
    // خرق تفرّد آخر في نفس معاملة إنشاء الرحلة (سجل استرداد الكوبون).
    const couponClash = p2002(["tripId"]);
    expect(() => rethrowAsActiveTripConflict(couponClash)).toThrow(couponClash);
    const other = p2002(["Trip_id_key"]);
    expect(() => rethrowAsActiveTripConflict(other)).toThrow(other);
    const boom = new Error("connection reset");
    expect(() => rethrowAsActiveTripConflict(boom)).toThrow(boom);
  });
});
