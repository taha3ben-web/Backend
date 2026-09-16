import { NotFoundException } from "@nestjs/common";
import { ScheduledTripsService } from "./scheduled-trips.service";

describe("ScheduledTripsService hardening", () => {
  const lock = {
    runExclusive: jest.fn((_key: string, task: () => unknown) => task()),
  };
  const prisma = {
    city: { findUnique: jest.fn() },
    trip: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const country = { currencyFor: jest.fn().mockResolvedValue("DZD") };
  const commission = {
    resolve: jest
      .fn()
      .mockResolvedValue({ commissionPct: 12, ruleId: "rule-1" }),
  };
  const service = new ScheduledTripsService(
    lock as any,
    prisma as any,
    country as any,
    commission as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it("binds cancellation to passenger and SCHEDULED state", async () => {
    prisma.trip.updateMany.mockResolvedValue({ count: 1 });
    prisma.trip.findUnique.mockResolvedValue({ id: "t1", status: "CANCELLED" });
    await service.cancel("t1", "p1");
    expect(prisma.trip.updateMany).toHaveBeenCalledWith({
      where: {
        id: "t1",
        passengerId: "p1",
        isScheduled: true,
        status: "SCHEDULED",
      },
      data: { status: "CANCELLED", cancelledBy: "PASSENGER" },
    });
  });

  it("does not disclose a lost ownership/state CAS", async () => {
    prisma.trip.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel("t1", "p2")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.trip.findUnique).not.toHaveBeenCalled();
  });

  it("isolates activation failures and returns activated/failed", async () => {
    prisma.trip.findMany.mockResolvedValue([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    prisma.trip.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error("P2002"))
      .mockResolvedValueOnce({ count: 0 });
    await expect(service.activateDueTripsTask()).resolves.toEqual({
      activated: 1,
      failed: 1,
    });
    expect(prisma.trip.updateMany).toHaveBeenCalledTimes(3);
  });

  it("snapshots the resolved commission", async () => {
    prisma.city.findUnique.mockResolvedValue({ country: "DZ" });
    prisma.trip.create.mockImplementation(async ({ data }: any) => data);
    const result = await service.create({
      passengerId: "p1",
      pickupLat: 36.7,
      pickupLng: 3.0,
      scheduledAt: new Date(Date.now() + 3_600_000),
      cityId: "city-1",
    });
    expect(commission.resolve).toHaveBeenCalledWith({
      countryCode: "DZ",
      cityId: "city-1",
    });
    expect(result).toMatchObject({
      commissionPct: 12,
      commissionRuleId: "rule-1",
    });
  });
});
