/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DriverSelfService } from "./driver-self.service";

/**
 * توحيد دورة حياة الرحلة — عقد "PATCH /driver/me/trips/:id/status".
 *
 * هذا المسار صار adapter توافق رفيعًا: كل دورة الحياة (آلة الحالات، الحارس
 * الذري، التسوية، تحرير السائق، إبطال الاتصالات، realtime، Push، الفاتورة
 * والولاء والمستوى) يملكها TripsService.driverChangeStatus وحدها.
 *
 * تُثبت هذه الاختبارات أمرين: أن العقد المنشور لم يتغيّر، وأن الخدمة لم
 * تعد تحتوي أي انتقال Prisma مستقل ولا أي أثر جانبي لدورة الحياة.
 */
describe("DriverSelfService.updateTripStatus — thin adapter to canonical lifecycle", () => {
  function buildHarness(options?: {
    driver?: { id: string } | null;
    owned?: { id: string } | null;
  }) {
    const canonicalResult = { id: "trip-1", status: "COMPLETED" };
    const prisma = {
      driver: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options?.driver === undefined ? { id: "driver-1" } : options.driver,
          ),
      },
      trip: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.owned === undefined ? { id: "trip-1" } : options.owned,
          ),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const trips = {
      driverChangeStatus: jest.fn().mockResolvedValue(canonicalResult),
      changeStatus: jest.fn(),
    };
    const profileLevels = {
      onTripCompleted: jest.fn(),
      forDriver: jest.fn(),
      forPassenger: jest.fn(),
    };
    const service = new DriverSelfService(
      prisma as any,
      {} as any,
      {} as any,
      trips as any,
      profileLevels as any,
      {} as any,
      {} as any,
    );
    return { service, prisma, trips, profileLevels, canonicalResult };
  }

  it("يسلّم الانتقال إلى driverChangeStatus مرة واحدة بالوسائط نفسها", async () => {
    const h = buildHarness();
    await h.service.updateTripStatus("user-1", "trip-1", "COMPLETED", "done");
    expect(h.trips.driverChangeStatus).toHaveBeenCalledTimes(1);
    expect(h.trips.driverChangeStatus).toHaveBeenCalledWith(
      "user-1",
      "trip-1",
      "COMPLETED",
      "done",
    );
  });

  it.each(["ARRIVING", "IN_PROGRESS", "COMPLETED"] as const)(
    "يسلّم الحالة المسموحة %s بلا تحقق انتقالات محلي",
    async (status) => {
      const h = buildHarness();
      await h.service.updateTripStatus("user-1", "trip-1", status);
      expect(h.trips.driverChangeStatus).toHaveBeenCalledWith(
        "user-1",
        "trip-1",
        status,
        undefined,
      );
    },
  );

  it("يُرجع ما أرجعه المسار canonical حرفيًا (نفس شكل الرد القديم: صف Trip)", async () => {
    const h = buildHarness();
    const result = await h.service.updateTripStatus(
      "user-1",
      "trip-1",
      "COMPLETED",
    );
    expect(result).toBe(h.canonicalResult);
  });

  it("لا يكتب أي انتقال Prisma مستقل على الرحلة", async () => {
    const h = buildHarness();
    await h.service.updateTripStatus("user-1", "trip-1", "COMPLETED");
    expect(h.prisma.trip.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.trip.update).not.toHaveBeenCalled();
  });

  it("لا ينفّذ أي أثر جانبي لاكتمال الرحلة (لا مستوى ملف شخصي هنا)", async () => {
    const h = buildHarness();
    await h.service.updateTripStatus("user-1", "trip-1", "COMPLETED");
    expect(h.profileLevels.onTripCompleted).not.toHaveBeenCalled();
  });

  it("يحفظ 404 عند غياب ملف السائق ولا يسلّم شيئًا", async () => {
    const h = buildHarness({ driver: null });
    await expect(
      h.service.updateTripStatus("user-1", "trip-1", "COMPLETED"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.trips.driverChangeStatus).not.toHaveBeenCalled();
  });

  it("يحفظ 404 (لا 403) عند عدم ملكية الرحلة ولا يسلّم شيئًا", async () => {
    const h = buildHarness({ owned: null });
    await expect(
      h.service.updateTripStatus("user-1", "trip-1", "COMPLETED"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.trips.driverChangeStatus).not.toHaveBeenCalled();
  });

  it("يفحص الملكية بمعرّف السائق المشتق من الجلسة لا من العميل", async () => {
    const h = buildHarness();
    await h.service.updateTripStatus("user-1", "trip-1", "COMPLETED");
    expect(h.prisma.trip.findFirst).toHaveBeenCalledWith({
      where: { id: "trip-1", driverId: "driver-1" },
      select: { id: true },
    });
  });

  it("يرفض CANCELLED عبر هذا المسار (عقد منشور) قبل أي تسليم", async () => {
    const h = buildHarness();
    await expect(
      h.service.updateTripStatus("user-1", "trip-1", "CANCELLED" as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.trips.driverChangeStatus).not.toHaveBeenCalled();
    expect(h.prisma.trip.updateMany).not.toHaveBeenCalled();
  });

  it("يرفض أي حالة خارج القائمة البيضاء", async () => {
    const h = buildHarness();
    await expect(
      h.service.updateTripStatus("user-1", "trip-1", "SEARCHING" as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.trips.driverChangeStatus).not.toHaveBeenCalled();
  });
});
