import { FareOffersService } from "./fare-offers.service";

describe("FareOffersService acceptance race", () => {
  const quote: any = {
    id: "q1",
    passengerId: "p1",
    tripId: null,
    status: "PROPOSED",
    expiresAt: new Date(Date.now() + 60_000),
    minFare: 90,
    maxFare: 120,
    suggestedFare: 100,
    proposedFare: 100,
    rideClass: "ECONOMY",
    vehicleTypeId: null,
    pickupLat: 1,
    pickupLng: 2,
    pickupAddress: null,
    destLat: 3,
    destLng: 4,
    destAddress: null,
    distanceKm: 5,
    durationSec: 600,
    currency: "DZD",
    cityId: null,
    commissionPct: 10,
    commissionRuleId: "rule-1",
  };
  const offer: any = {
    id: "o1",
    fareQuoteId: "q1",
    driverId: "d1",
    amount: 100,
    currency: "DZD",
    status: "PENDING",
    expiresAt: new Date(Date.now() + 60_000),
  };

  function setup() {
    const tx: any = {
      fareQuote: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
        update: jest.fn(),
      },
      fareOffer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...offer, status: "ACCEPTED" }),
      },
      driver: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ userId: "du1" }),
      },
      trip: {
        create: jest.fn().mockResolvedValue({
          id: "t1",
          passengerId: "p1",
          status: "ACCEPTED",
        }),
      },
    };
    const prisma: any = {
      fareQuote: { findUnique: jest.fn().mockResolvedValue(quote) },
      fareOffer: { findUnique: jest.fn().mockResolvedValue(offer) },
      trip: { findFirst: jest.fn().mockResolvedValue(null) },
      driver: { findUnique: jest.fn().mockResolvedValue({ userId: "du1" }) },
      $transaction: jest.fn((fn: (client: any) => unknown) => fn(tx)),
    };
    const financial = {
      assertDriverCommissionCoverage: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FareOffersService(
      {} as any,
      prisma,
      { emitToUser: jest.fn(), emitTripStatus: jest.fn() } as any,
      { notifyUser: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      financial as any,
    );
    return { service, tx, financial };
  }

  it("has one winner and checks financial coverage", async () => {
    const { service, tx, financial } = setup();
    const results = await Promise.allSettled([
      service.acceptOffer("p1", "q1", "o1"),
      service.acceptOffer("p1", "q1", "o1"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(tx.driver.updateMany).toHaveBeenCalledTimes(1);
    expect(financial.assertDriverCommissionCoverage).toHaveBeenCalledTimes(1);
    expect(financial.assertDriverCommissionCoverage).toHaveBeenCalledWith(tx, {
      driverUserId: "du1",
      currency: "DZD",
      commissionDue: 10,
      electronicallyCollected: 0,
      tripId: undefined,
    });
    expect(tx.trip.create).toHaveBeenCalledTimes(1);
    expect(tx.trip.create.mock.calls[0][0].data).toMatchObject({
      commissionPct: 10,
      commissionRuleId: "rule-1",
    });
  });

  it("does not create a trip when coverage fails", async () => {
    const { service, tx, financial } = setup();
    financial.assertDriverCommissionCoverage.mockRejectedValueOnce(
      new Error("coverage"),
    );
    await expect(service.acceptOffer("p1", "q1", "o1")).rejects.toThrow(
      "coverage",
    );
    expect(tx.trip.create).not.toHaveBeenCalled();
  });
});
