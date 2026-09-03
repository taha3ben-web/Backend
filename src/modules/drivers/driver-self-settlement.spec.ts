/**
 * P0-1 — إكمال الرحلة عبر PATCH /driver/me/trips/:id/status يجب أن يجعل
 * الرحلة مؤهلة لشبكة التسوية القائمة (settlementStatus = PENDING).
 *
 * هذا اختبار وحدة خالص: لا قاعدة بيانات ولا Redis. يتحقق فقط من عقد
 * الكتابة الذي تُصدره updateTripStatus. أما خصائص التسوية نفسها
 * (idempotency، توازن دفتر الأستاذ، Serializable) فلا تُثبت إلا مقابل
 * Postgres حقيقي، ومكانها financial.integration.spec.ts.
 *
 * ملاحظة: الأنواع مُرخّاة (any) كما في مجرّبات الاختبار الأخرى في هذا
 * المستودع لأنّها تلامس Prisma Client المُولّد.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from "@nestjs/common";
import { DriverSelfService } from "./driver-self.service";

type UpdateManyArgs = { where: any; data: any };

function buildHarness(options: {
  tripStatus: string;
  settlementStatus?: string;
  updatedCount?: number;
}) {
  const trip = {
    id: "trip-1",
    driverId: "driver-1",
    status: options.tripStatus,
    settlementStatus: options.settlementStatus ?? "NOT_REQUIRED",
    settledAt: null,
    pickupLat: 36.75,
    pickupLng: 3.06,
  };
  const updateManyCalls: UpdateManyArgs[] = [];
  const prisma = {
    driver: {
      findUnique: jest.fn(async () => ({ id: "driver-1", userId: "user-1" })),
    },
    trip: {
      findUnique: jest.fn(async () => trip),
      updateMany: jest.fn(async (args: UpdateManyArgs) => {
        updateManyCalls.push(args);
        return { count: options.updatedCount ?? 1 };
      }),
    },
  } as any;
  const arrivalGuard = {
    assertCanMarkArriving: jest.fn(async () => undefined),
  } as any;
  const profileLevels = {
    onTripCompleted: jest.fn(async () => undefined),
  } as any;
  const service = new DriverSelfService(
    prisma,
    {} as any,
    {} as any,
    arrivalGuard,
    profileLevels,
    {} as any,
    {} as any,
  );
  return { service, prisma, trip, updateManyCalls, profileLevels };
}

describe("DriverSelfService.updateTripStatus — settlement eligibility (P0-1)", () => {
  it("يكتب settlementStatus=PENDING عند الإكمال", async () => {
    const h = buildHarness({ tripStatus: "IN_PROGRESS" });
    await h.service.updateTripStatus("user-1", "trip-1", "COMPLETED");
    expect(h.updateManyCalls).toHaveLength(1);
    expect(h.updateManyCalls[0].data.settlementStatus).toBe("PENDING");
    expect(h.updateManyCalls[0].data.status).toBe("COMPLETED");
    expect(h.updateManyCalls[0].data.completedAt).toBeInstanceOf(Date);
  });

  it("لا يترك الرحلة على NOT_REQUIRED بعد الإكمال", async () => {
    const h = buildHarness({
      tripStatus: "IN_PROGRESS",
      settlementStatus: "NOT_REQUIRED",
    });
    await h.service.updateTripStatus("user-1", "trip-1", "COMPLETED");
    expect(h.trip.settlementStatus).toBe("NOT_REQUIRED");
    expect(h.updateManyCalls[0].data.settlementStatus).not.toBe("NOT_REQUIRED");
    expect(h.updateManyCalls[0].data.settlementStatus).toBe("PENDING");
  });

  it("يحافظ على الحارس الذري (where.status = الحالة المقروءة)", async () => {
    const h = buildHarness({ tripStatus: "IN_PROGRESS" });
    await h.service.updateTripStatus("user-1", "trip-1", "COMPLETED");
    expect(h.updateManyCalls[0].where).toEqual({
      id: "trip-1",
      status: "IN_PROGRESS",
    });
  });

  it("يرفض الإكمال المزدوج عندما لا يطابق الحارس أي صف", async () => {
    const h = buildHarness({ tripStatus: "IN_PROGRESS", updatedCount: 0 });
    await expect(
      h.service.updateTripStatus("user-1", "trip-1", "COMPLETED"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.profileLevels.onTripCompleted).not.toHaveBeenCalled();
  });

  it("يرفض الإكمال من حالة غير IN_PROGRESS ولا يكتب شيئًا", async () => {
    const h = buildHarness({ tripStatus: "COMPLETED" });
    await expect(
      h.service.updateTripStatus("user-1", "trip-1", "COMPLETED"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.updateManyCalls).toHaveLength(0);
  });

  it("لا يمسّ settlementStatus في الانتقالات غير المكتملة", async () => {
    const arriving = buildHarness({ tripStatus: "ACCEPTED" });
    await arriving.service.updateTripStatus("user-1", "trip-1", "ARRIVING");
    expect(arriving.updateManyCalls[0].data.settlementStatus).toBeUndefined();

    const inProgress = buildHarness({ tripStatus: "ARRIVING" });
    await inProgress.service.updateTripStatus(
      "user-1",
      "trip-1",
      "IN_PROGRESS",
    );
    expect(inProgress.updateManyCalls[0].data.settlementStatus).toBeUndefined();
    expect(inProgress.updateManyCalls[0].data.startedAt).toBeInstanceOf(Date);
  });

  it("يبقي شكل الاستجابة كما هو (صف الرحلة المحمّل)", async () => {
    const h = buildHarness({ tripStatus: "IN_PROGRESS" });
    const result = await h.service.updateTripStatus(
      "user-1",
      "trip-1",
      "COMPLETED",
      "سبب",
    );
    expect(result).toBe(h.trip as any);
    expect(h.updateManyCalls[0].data.cancelReason).toBe("سبب");
  });
});
