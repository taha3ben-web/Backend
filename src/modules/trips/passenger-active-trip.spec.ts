import {
  ACTIVE_IMMEDIATE_TRIP_STATUSES,
  isActiveImmediateTripStatus,
} from "./trip-transitions";
import type { TripStatus } from "@prisma/client";
import {
  ACTIVE_TRIP_UNIQUE_INDEX,
  rethrowAsActiveTripConflict,
} from "../../common/api/prisma-error.util";
import { AppException } from "../../common/api/app.exception";

/**
 * قاعدة تزامن رحلات الراكب.
 *
 * ===== النموذج المطلوب =====
 *   حجز مستقبلي (SCHEDULED) + رحلة فورية الآن  = مسموح
 *   رحلة فورية + رحلة فورية أخرى               = مرفوض
 *   بعد الإلغاء/الإكمال                        = رحلة فورية جديدة مسموحة
 *
 * ===== ما تحاكيه الاختبارات =====
 * `FakeTripStore` يحاكي الفهرس الجزئي الفريد في PostgreSQL:
 *   CREATE UNIQUE INDEX "Trip_active_passenger_unique" ON "Trip"("passengerId")
 *     WHERE status IN ('SEARCHING','ACCEPTED','ARRIVING','IN_PROGRESS');
 * أي كتابة تخالفه ترمي خطأ P2002 بنفس شكل Prisma، فنُثبت أن المسار يترجمه
 * إلى `ACTIVE_TRIP_EXISTS` بدل HTTP 500. التحقّق على قاعدة بيانات حقيقية
 * مُنفَّذ عبر `scripts/verify-trip-concurrency.sql`.
 */

interface FakeTrip {
  id: string;
  passengerId: string;
  status: TripStatus;
}

class UniqueViolation extends Error {
  readonly code = "P2002";
  readonly meta = { target: ACTIVE_TRIP_UNIQUE_INDEX };
  constructor() {
    super(
      `Unique constraint failed on the constraint: \`${ACTIVE_TRIP_UNIQUE_INDEX}\``,
    );
  }
}

class FakeTripStore {
  private readonly rows: FakeTrip[] = [];
  private seq = 0;

  /** يفرض الفهرس الجزئي: راكب واحد ← رحلة فورية واحدة. */
  private assertIndex(passengerId: string, status: TripStatus, id?: string) {
    if (!isActiveImmediateTripStatus(status)) return;
    const clash = this.rows.some(
      (row) =>
        row.passengerId === passengerId &&
        row.id !== id &&
        isActiveImmediateTripStatus(row.status),
    );
    if (clash) throw new UniqueViolation();
  }

  create(passengerId: string, status: TripStatus): FakeTrip {
    this.assertIndex(passengerId, status);
    const row: FakeTrip = {
      id: `trip-${++this.seq}`,
      passengerId,
      status,
    };
    this.rows.push(row);
    return row;
  }

  setStatus(id: string, status: TripStatus): void {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error("not found");
    this.assertIndex(row.passengerId, status, id);
    row.status = status;
  }

  /** نظير `GET /rides/current`: الرحلة الفورية الجارية + الحجوزات. */
  currentTrip(passengerId: string): {
    current: FakeTrip | null;
    scheduled: FakeTrip[];
  } {
    return {
      current:
        this.rows.find(
          (r) =>
            r.passengerId === passengerId &&
            isActiveImmediateTripStatus(r.status),
        ) ?? null,
      scheduled: this.rows.filter(
        (r) => r.passengerId === passengerId && r.status === "SCHEDULED",
      ),
    };
  }
}

/** نظير مسار الطلب: ينشئ الرحلة ويترجم خرق القيد إلى خطأ نطاق. */
function requestImmediateRide(store: FakeTripStore, passengerId: string) {
  try {
    return store.create(passengerId, "SEARCHING");
  } catch (error) {
    return rethrowAsActiveTripConflict(error, { passengerId });
  }
}

const PASSENGER = "passenger-1";

describe("passenger trip uniqueness — status set", () => {
  it("blocks only SEARCHING/ACCEPTED/ARRIVING/IN_PROGRESS", () => {
    expect(ACTIVE_IMMEDIATE_TRIP_STATUSES).toEqual([
      "SEARCHING",
      "ACCEPTED",
      "ARRIVING",
      "IN_PROGRESS",
    ]);
  });

  it("does NOT include SCHEDULED (a future booking must never block now)", () => {
    expect(ACTIVE_IMMEDIATE_TRIP_STATUSES).not.toContain("SCHEDULED");
    expect(isActiveImmediateTripStatus("SCHEDULED")).toBe(false);
  });

  it("does not include terminal statuses", () => {
    expect(isActiveImmediateTripStatus("COMPLETED")).toBe(false);
    expect(isActiveImmediateTripStatus("CANCELLED")).toBe(false);
  });
});

describe("immediate ride requests", () => {
  it("1. no current trip → the immediate request succeeds", () => {
    const store = new FakeTripStore();
    const trip = requestImmediateRide(store, PASSENGER);
    expect(trip.status).toBe("SEARCHING");
  });

  it.each<TripStatus>(["SEARCHING", "ACCEPTED", "ARRIVING", "IN_PROGRESS"])(
    "2-5. a current %s trip rejects a second immediate request",
    (status) => {
      const store = new FakeTripStore();
      const first = store.create(PASSENGER, "SEARCHING");
      if (status !== "SEARCHING") store.setStatus(first.id, status);

      let caught: unknown;
      try {
        requestImmediateRide(store, PASSENGER);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppException);
      expect((caught as AppException).code).toBe("ACTIVE_TRIP_EXISTS");
      expect((caught as AppException).getStatus()).toBe(409);
    },
  );

  it("6. a SCHEDULED trip next week does not block an immediate request", () => {
    const store = new FakeTripStore();
    store.create(PASSENGER, "SCHEDULED");
    const immediate = requestImmediateRide(store, PASSENGER);
    expect(immediate.status).toBe("SEARCHING");
  });

  it("7. scheduled + immediate coexist, and the scheduled one stays scheduled", () => {
    const store = new FakeTripStore();
    const booking = store.create(PASSENGER, "SCHEDULED");
    const immediate = requestImmediateRide(store, PASSENGER);
    const state = store.currentTrip(PASSENGER);
    expect(state.current?.id).toBe(immediate.id);
    expect(state.scheduled.map((t) => t.id)).toEqual([booking.id]);
    // الحجز لا يُعاد كرحلة جارية إطلاقًا.
    expect(state.current?.id).not.toBe(booking.id);
  });

  it("8-9. two simultaneous requests: exactly one wins, the loser gets a domain error", () => {
    const store = new FakeTripStore();
    const results = ["a", "b"].map(() => {
      try {
        return { ok: true as const, trip: requestImmediateRide(store, PASSENGER) };
      } catch (error) {
        return { ok: false as const, error };
      }
    });
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser?.ok).toBe(false);
    const error = (loser as { error: unknown }).error;
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe("ACTIVE_TRIP_EXISTS");
    // ليس 500، وليست رسالة Prisma خام.
    expect((error as AppException).getStatus()).not.toBe(500);
    expect((error as AppException).getStatus()).toBe(409);
  });

  it("10. app restart returns the current immediate ride, not a new trip", () => {
    const store = new FakeTripStore();
    const trip = requestImmediateRide(store, PASSENGER);
    store.setStatus(trip.id, "ACCEPTED");
    // التطبيق أُغلق ثم أُعيد فتحه ⇒ يقرأ الحالة فقط.
    const restored = store.currentTrip(PASSENGER);
    expect(restored.current?.id).toBe(trip.id);
    expect(restored.current?.status).toBe("ACCEPTED");
    // وطلب رحلة جديدة (لو حاول التطبيق) ما زال مرفوضًا.
    expect(() => requestImmediateRide(store, PASSENGER)).toThrow(AppException);
  });

  it("a new immediate ride is allowed after cancellation", () => {
    const store = new FakeTripStore();
    const first = requestImmediateRide(store, PASSENGER);
    store.setStatus(first.id, "CANCELLED");
    const second = requestImmediateRide(store, PASSENGER);
    expect(second.id).not.toBe(first.id);
    expect(store.currentTrip(PASSENGER).current?.id).toBe(second.id);
  });

  it("a new immediate ride is allowed after completion", () => {
    const store = new FakeTripStore();
    const first = requestImmediateRide(store, PASSENGER);
    store.setStatus(first.id, "IN_PROGRESS");
    store.setStatus(first.id, "COMPLETED");
    expect(() => requestImmediateRide(store, PASSENGER)).not.toThrow();
  });

  it("the rule is per passenger, not global", () => {
    const store = new FakeTripStore();
    requestImmediateRide(store, "passenger-a");
    expect(() => requestImmediateRide(store, "passenger-b")).not.toThrow();
  });

  it("activating a scheduled trip is blocked while an immediate ride is live", () => {
    // تفعيل الحجز يحوّله إلى SEARCHING، وهي حالة يحجبها الفهرس.
    // السلوك المطلوب: الفشل مرئي في القاعدة بدل رحلتين فوريتين للراكب.
    const store = new FakeTripStore();
    const booking = store.create(PASSENGER, "SCHEDULED");
    requestImmediateRide(store, PASSENGER);
    expect(() => store.setStatus(booking.id, "SEARCHING")).toThrow(
      /Trip_active_passenger_unique/,
    );
  });
});
