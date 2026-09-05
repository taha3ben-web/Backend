/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { TripsService } from "./trips.service";

/**
 * دورة حياة الرحلة canonical — سلوك الإكمال داخل TripsService وحده.
 *
 * هذه الاختبارات تُثبت السلوك لا تفاصيل التنفيذ: أي مصدر يطلب تغيير حالة
 * الرحلة يمرّ عبر driverChangeStatus → changeStatus، فتُنفَّذ آلة الحالات ثم
 * الحارس الذري ثم التسوية ثم الآثار التشغيلية ثم البثّ اللحظي.
 *
 * الضمانات المنقولة من driver-self-settlement.spec.ts المحذوف محفوظة هنا
 * كاملة، لكن على المصدر canonical بدل النسخة القديمة في DriverSelfService:
 * settlementStatus=PENDING عند الإكمال، غيابه في الانتقالات الأخرى،
 * startedAt عند IN_PROGRESS، الحارس الذري بحالة الرحلة، رفض count=0،
 * رفض الإكمال من حالة غير IN_PROGRESS، cancelReason عند الإلغاء، وشكل
 * الرد = صف الرحلة.
 */

type HarnessOptions = {
  status?: string;
  updatedCount?: number;
  settlementFails?: boolean;
};

function buildHarness(options: HarnessOptions = {}) {
  const trip = {
    id: "trip-1",
    driverId: "driver-1",
    passengerId: "passenger-1",
    status: options.status ?? "IN_PROGRESS",
    pickupLat: 36.75,
    pickupLng: 3.06,
    driver: { userId: "driver-user-1" },
  };
  const prisma = {
    trip: {
      findUnique: jest.fn().mockResolvedValue(trip),
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: options.updatedCount ?? 1 }),
    },
    tripEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
    driver: {
      update: jest.fn().mockResolvedValue({ userId: "driver-user-1" }),
      findUnique: jest.fn().mockResolvedValue({ userId: "driver-user-1" }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ locale: "ar" }) },
  };
  const realtime = { emitTripStatus: jest.fn() };
  const financial = {
    settleTrip: options.settlementFails
      ? jest.fn().mockRejectedValue(new Error("ledger unavailable"))
      : jest.fn().mockResolvedValue(undefined),
    settleDriverCancellationPenalty: jest.fn().mockResolvedValue(undefined),
    settlePassengerCancellationFee: jest.fn().mockResolvedValue(undefined),
  };
  const redis = {
    client: {
      del: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue("OK"),
    },
  };
  const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };
  const settings = {
    getValue: jest.fn().mockResolvedValue({
      ar: {
        COMPLETED: { title: "انتهت الرحلة", body: "شكرًا لاستخدامك التطبيق" },
      },
    }),
  };
  const deviation = {
    forget: jest.fn(),
    check: jest.fn().mockResolvedValue(undefined),
  };
  const invoices = {
    issueForTrip: jest.fn().mockResolvedValue({ number: "INV-1" }),
  };
  const loyalty = { earnFromTrip: jest.fn().mockResolvedValue(0) };
  const referral = {
    qualifyReferral: jest.fn().mockResolvedValue({ rewarded: false }),
  };
  const mailer = { fireAndForget: jest.fn() };
  const calls = { revokeForTrip: jest.fn().mockResolvedValue(undefined) };
  const arrivalGuard = {
    assertCanMarkArriving: jest.fn().mockResolvedValue(undefined),
  };
  const profileLevels = {
    onTripCompleted: jest.fn().mockResolvedValue(undefined),
  };

  const service = new TripsService(
    prisma as any,
    realtime as any,
    financial as any,
    redis as any,
    notifications as any,
    settings as any,
    deviation as any,
    invoices as any,
    loyalty as any,
    referral as any,
    mailer as any,
    calls as any,
    arrivalGuard as any,
    profileLevels as any,
  );

  const loggedErrors: unknown[] = [];
  jest
    .spyOn((service as any).logger, "error")
    .mockImplementation((message: unknown) => {
      loggedErrors.push(message);
    });
  jest
    .spyOn((service as any).logger, "warn")
    .mockImplementation(() => undefined);
  jest
    .spyOn((service as any).logger, "log")
    .mockImplementation(() => undefined);

  return {
    service,
    prisma,
    realtime,
    financial,
    redis,
    notifications,
    deviation,
    invoices,
    calls,
    arrivalGuard,
    profileLevels,
    trip,
    loggedErrors,
  };
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe("TripsService — canonical completion orchestration", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("عند نجاح التسوية: يسوّي ثم يحرّر السائق ويبطل الاتصالات ويبثّ ويُشعر ويُرجع صف الرحلة", async () => {
    const h = buildHarness();

    const result = await h.service.driverChangeStatus(
      "driver-user-1",
      "trip-1",
      "COMPLETED" as any,
    );
    await flushMicrotasks();

    expect(h.financial.settleTrip).toHaveBeenCalledWith("trip-1");
    expect(h.prisma.driver.update).toHaveBeenCalledWith({
      where: { id: "driver-1" },
      data: { availability: "ONLINE" },
      select: { userId: true },
    });
    expect(h.redis.client.del).toHaveBeenCalledWith(
      "driver:driver-user-1:trip",
    );
    expect(h.calls.revokeForTrip).toHaveBeenCalledWith("trip-1");
    expect(h.deviation.forget).toHaveBeenCalledWith("trip-1");
    expect(h.realtime.emitTripStatus).toHaveBeenCalledWith(
      "trip-1",
      "COMPLETED",
    );
    expect(h.notifications.notifyUser).toHaveBeenCalled();
    expect(result).toBe(h.trip);
  });

  it("عند فشل التسوية: يُسجّل الخطأ ولا يفشل الطلب وتستمر كل الآثار التشغيلية", async () => {
    const h = buildHarness({ settlementFails: true });

    const result = await h.service.driverChangeStatus(
      "driver-user-1",
      "trip-1",
      "COMPLETED" as any,
    );
    await flushMicrotasks();

    expect(h.loggedErrors.length).toBeGreaterThan(0);
    expect(h.prisma.driver.update).toHaveBeenCalled();
    expect(h.calls.revokeForTrip).toHaveBeenCalledWith("trip-1");
    expect(h.deviation.forget).toHaveBeenCalledWith("trip-1");
    expect(h.realtime.emitTripStatus).toHaveBeenCalledWith(
      "trip-1",
      "COMPLETED",
    );
    expect(result).toBe(h.trip);
  });

  it("لا يكتب حالة تسوية يدويًا عند الفشل: مصدر الحقيقة هو FinancialService", async () => {
    const h = buildHarness({ settlementFails: true });

    await h.service.changeStatus("trip-1", "COMPLETED" as any);
    await flushMicrotasks();

    const writes = h.prisma.trip.updateMany.mock.calls.map(
      (call: any) => call[0].data,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].settlementStatus).toBe("PENDING");
    expect(writes.some((data: any) => data.settlementStatus === "FAILED")).toBe(
      false,
    );
  });

  it("الإكمال يكتب PENDING و completedAt في نفس الكتابة الذرية", async () => {
    const h = buildHarness();

    await h.service.changeStatus("trip-1", "COMPLETED" as any);

    const write = h.prisma.trip.updateMany.mock.calls[0][0];
    expect(write.data.status).toBe("COMPLETED");
    expect(write.data.settlementStatus).toBe("PENDING");
    expect(write.data.completedAt).toBeInstanceOf(Date);
  });

  it("يبقي الحارس الذري مشروطًا بالحالة الحالية للرحلة", async () => {
    const h = buildHarness();

    await h.service.changeStatus("trip-1", "COMPLETED" as any);

    const write = h.prisma.trip.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: "trip-1", status: "IN_PROGRESS" });
  });

  it("عند خسارة التنافس (count = 0) يرفض الطلب ولا يسوّي ولا يبثّ", async () => {
    const h = buildHarness({ updatedCount: 0 });

    await expect(
      h.service.changeStatus("trip-1", "COMPLETED" as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.financial.settleTrip).not.toHaveBeenCalled();
    expect(h.prisma.driver.update).not.toHaveBeenCalled();
    expect(h.calls.revokeForTrip).not.toHaveBeenCalled();
    expect(h.realtime.emitTripStatus).not.toHaveBeenCalled();
  });

  it("يرفض الإكمال من حالة غير IN_PROGRESS بلا أي كتابة", async () => {
    const h = buildHarness({ status: "ACCEPTED" });

    await expect(
      h.service.changeStatus("trip-1", "COMPLETED" as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.prisma.trip.updateMany).not.toHaveBeenCalled();
    expect(h.financial.settleTrip).not.toHaveBeenCalled();
  });

  it("الانتقال إلى IN_PROGRESS يكتب startedAt ولا يلمس حالة التسوية", async () => {
    const h = buildHarness({ status: "ARRIVING" });

    await h.service.changeStatus("trip-1", "IN_PROGRESS" as any);

    const write = h.prisma.trip.updateMany.mock.calls[0][0];
    expect(write.data.startedAt).toBeInstanceOf(Date);
    expect(write.data.settlementStatus).toBeUndefined();
    expect(h.financial.settleTrip).not.toHaveBeenCalled();
  });

  it("الإلغاء يحفظ السبب والطرف الملغي ويشغّل السياسة المالية للإلغاء", async () => {
    const h = buildHarness();

    await h.service.changeStatus(
      "trip-1",
      "CANCELLED" as any,
      "سبب",
      "PASSENGER" as any,
    );
    await flushMicrotasks();

    const write = h.prisma.trip.updateMany.mock.calls[0][0];
    expect(write.data.cancelReason).toBe("سبب");
    expect(write.data.cancelledBy).toBe("PASSENGER");
    expect(write.data.settlementStatus).toBeUndefined();
    expect(h.financial.settlePassengerCancellationFee).toHaveBeenCalledWith(
      "trip-1",
    );
    expect(h.prisma.driver.update).toHaveBeenCalled();
    expect(h.calls.revokeForTrip).toHaveBeenCalledWith("trip-1");
  });

  it("يرفض 404 عند غياب الرحلة قبل أي كتابة", async () => {
    const h = buildHarness();
    h.prisma.trip.findUnique.mockResolvedValue(null);

    await expect(
      h.service.driverChangeStatus(
        "driver-user-1",
        "trip-1",
        "COMPLETED" as any,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.prisma.trip.updateMany).not.toHaveBeenCalled();
  });

  it("يرفض سائقًا ليس مكلّفًا بالرحلة قبل أي كتابة", async () => {
    const h = buildHarness();

    await expect(
      h.service.driverChangeStatus(
        "someone-else",
        "trip-1",
        "COMPLETED" as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.trip.updateMany).not.toHaveBeenCalled();
  });

  it("حارس الوصول يعمل على ARRIVING فقط", async () => {
    const arriving = buildHarness({ status: "ACCEPTED" });
    await arriving.service.driverChangeStatus(
      "driver-user-1",
      "trip-1",
      "ARRIVING" as any,
    );
    expect(arriving.arrivalGuard.assertCanMarkArriving).toHaveBeenCalledTimes(
      1,
    );

    const completing = buildHarness();
    await completing.service.driverChangeStatus(
      "driver-user-1",
      "trip-1",
      "COMPLETED" as any,
    );
    await flushMicrotasks();
    expect(
      completing.arrivalGuard.assertCanMarkArriving,
    ).not.toHaveBeenCalled();
  });
});
