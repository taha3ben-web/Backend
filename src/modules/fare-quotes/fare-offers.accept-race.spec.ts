import { FareOffersService } from "./fare-offers.service";

/**
 * اختبار انحدار مركّز لسباق قبول العروض (acceptOffer).
 *
 * لا يتصل بقاعدة بيانات حقيقية: يستبدل Prisma بمخزن في الذاكرة **يقيّم شروط
 * where فعليًا**، فإسقاط أي شرط من شروط CAS يجعل هذه الاختبارات تفشل.
 * هذا ليس اختبار تزامن حقيقي متعدد العمليات على PostgreSQL.
 */

type QuoteRow = {
  id: string;
  passengerId: string;
  status: string;
  tripId: string | null;
  proposedFare: unknown;
  proposedAt: Date | null;
  rideClass: string;
  vehicleTypeId: string | null;
  cityId: string | null;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string | null;
  destLat: number | null;
  destLng: number | null;
  destAddress: string | null;
  distanceKm: number | null;
  durationSec: number | null;
  currency: string;
  suggestedFare: number;
  minFare: number;
  maxFare: number;
  passengerNote: string | null;
  commissionPct: number;
  expiresAt: Date;
};

type OfferRow = {
  id: string;
  fareQuoteId: string;
  driverId: string;
  amount: number;
  currency: string;
  note: string | null;
  etaMinutes: number | null;
  status: string;
  expiresAt: Date | null;
  respondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const PASSENGER = "passenger-1";
const FUTURE = () => new Date(Date.now() + 60_000);

function makeQuote(id: string, overrides: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id,
    passengerId: PASSENGER,
    status: "PROPOSED",
    tripId: null,
    proposedFare: null,
    proposedAt: null,
    rideClass: "ECONOMY",
    vehicleTypeId: null,
    cityId: null,
    pickupLat: 36.75,
    pickupLng: 3.06,
    pickupAddress: "A",
    destLat: 36.8,
    destLng: 3.1,
    destAddress: "B",
    distanceKm: 5,
    durationSec: 600,
    currency: "DZD",
    suggestedFare: 500,
    minFare: 300,
    maxFare: 900,
    passengerNote: null,
    commissionPct: 15,
    expiresAt: FUTURE(),
    ...overrides,
  };
}

function makeOffer(
  id: string,
  fareQuoteId: string,
  driverId: string,
  amount = 500,
): OfferRow {
  return {
    id,
    fareQuoteId,
    driverId,
    amount,
    currency: "DZD",
    note: null,
    etaMinutes: 4,
    status: "PENDING",
    expiresAt: FUTURE(),
    respondedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** يقيّم شرط where مبسّطًا (مساواة، { in: [...] }، { not: x }، null). */
function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond !== null && typeof cond === "object") {
      const c = cond as Record<string, unknown>;
      if (Array.isArray(c.in)) return (c.in as unknown[]).includes(value);
      if ("not" in c) return value !== c.not;
      return false;
    }
    return value === cond;
  });
}

function buildHarness(quotes: QuoteRow[], offers: OfferRow[]) {
  const store = {
    quotes,
    offers,
    drivers: new Map<string, string>(),
    trips: [] as Array<Record<string, unknown>>,
  };

  const prisma: Record<string, unknown> = {
    fareQuote: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        store.quotes.find((q) => q.id === where.id) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const hit = store.quotes.filter((q) =>
            matches(q as unknown as Record<string, unknown>, where),
          );
          hit.forEach((q) => Object.assign(q, data));
          return { count: hit.length };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const q = store.quotes.find((row) => row.id === where.id)!;
          Object.assign(q, data);
          return q;
        },
      ),
    },
    fareOffer: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        store.offers.find((o) => o.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        store.offers.filter((o) =>
          matches(o as unknown as Record<string, unknown>, where),
        ),
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const hit = store.offers.filter((o) =>
            matches(o as unknown as Record<string, unknown>, where),
          );
          hit.forEach((o) => Object.assign(o, data));
          return { count: hit.length };
        },
      ),
      update: jest.fn(),
    },
    driver: {
      findUnique: jest.fn(async () => ({ userId: "driver-user" })),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const id = where.id as string;
          const current = store.drivers.get(id) ?? "ONLINE";
          if (where.availability !== current) return { count: 0 };
          store.drivers.set(id, "ON_TRIP");
          return { count: 1 };
        },
      ),
    },
    trip: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const trip = { id: `trip-${store.trips.length + 1}`, ...data };
        store.trips.push(trip);
        return trip;
      }),
    },
    // معاملة مُقلّدة: إذا رمت الدالة نُرجِع السائق والرحلات إلى ما قبل المحاولة
    // (محاكاة لـ ROLLBACK؛ ليست معاملة حقيقية).
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) => {
      const driverSnapshot = new Map(store.drivers);
      const tripCount = store.trips.length;
      const quoteSnapshot = store.quotes.map((q) => ({ ...q }));
      const offerSnapshot = store.offers.map((o) => ({ ...o }));
      try {
        return await fn(prisma);
      } catch (err) {
        store.drivers = driverSnapshot;
        store.trips.length = tripCount;
        store.quotes.forEach((q, i) => Object.assign(q, quoteSnapshot[i]));
        store.offers.forEach((o, i) => Object.assign(o, offerSnapshot[i]));
        throw err;
      }
    }),
  };

  const service = new FareOffersService(
    {} as never,
    prisma as never,
    { emitToUser: jest.fn(), emitTripStatus: jest.fn() } as never,
    { notifyUser: jest.fn().mockResolvedValue(undefined) } as never,
    { resolveStoredUrl: jest.fn() } as never,
  );

  return { service, prisma, store };
}

describe("FareOffersService.acceptOffer — quote-level CAS", () => {
  it("accepts a single offer normally and links the quote to the trip", async () => {
    const quote = makeQuote("q1");
    const offer = makeOffer("o1", "q1", "driver-1");
    const { service, store } = buildHarness([quote], [offer]);

    const res = await service.acceptOffer(PASSENGER, "q1", "o1");

    expect(store.trips).toHaveLength(1);
    expect(quote.status).toBe("ACCEPTED");
    expect(quote.tripId).toBe(store.trips[0].id);
    expect(offer.status).toBe("ACCEPTED");
    expect(store.drivers.get("driver-1")).toBe("ON_TRIP");
    expect(res.tripId).toBe(store.trips[0].id);
  });

  it("elects exactly one winner when two offers on the same quote are accepted", async () => {
    const quote = makeQuote("q1");
    const first = makeOffer("o1", "q1", "driver-1");
    const second = makeOffer("o2", "q1", "driver-2", 600);
    const { service, store } = buildHarness([quote], [first, second]);

    const results = await Promise.allSettled([
      service.acceptOffer(PASSENGER, "q1", "o1"),
      service.acceptOffer(PASSENGER, "q1", "o2"),
    ]);

    const winners = results.filter((r) => r.status === "fulfilled");
    expect(winners).toHaveLength(1);
    // رحلة واحدة فقط لعرض سعر واحد.
    expect(store.trips).toHaveLength(1);
    // سائق واحد فقط أصبح ON_TRIP — الخاسر لم يترك سائقًا عالقًا.
    const onTrip = [...store.drivers.values()].filter((v) => v === "ON_TRIP");
    expect(onTrip).toHaveLength(1);
    // حالة عرض السعر تشير إلى الرحلة الفائزة وحدها.
    expect(quote.status).toBe("ACCEPTED");
    expect(quote.tripId).toBe(store.trips[0].id);
    // عرض واحد ACCEPTED، والآخر ليس ACCEPTED.
    const accepted = [first, second].filter((o) => o.status === "ACCEPTED");
    expect(accepted).toHaveLength(1);
  });

  it("rejects acceptance when the quote already carries a trip", async () => {
    const quote = makeQuote("q1", { status: "ACCEPTED", tripId: "trip-old" });
    const offer = makeOffer("o1", "q1", "driver-1");
    const { service, store } = buildHarness([quote], [offer]);

    await expect(service.acceptOffer(PASSENGER, "q1", "o1")).rejects.toThrow();
    expect(store.trips).toHaveLength(0);
    expect(store.drivers.size).toBe(0);
    expect(offer.status).toBe("PENDING");
  });

  it("does not let a foreign passenger accept an offer", async () => {
    const quote = makeQuote("q1");
    const offer = makeOffer("o1", "q1", "driver-1");
    const { service, store } = buildHarness([quote], [offer]);

    await expect(
      service.acceptOffer("passenger-2", "q1", "o1"),
    ).rejects.toThrow();
    expect(store.trips).toHaveLength(0);
    expect(quote.status).toBe("PROPOSED");
  });

  it("keeps different quotes independent", async () => {
    const q1 = makeQuote("q1");
    const q2 = makeQuote("q2");
    const o1 = makeOffer("o1", "q1", "driver-1");
    const o2 = makeOffer("o2", "q2", "driver-2");
    const { service, store } = buildHarness([q1, q2], [o1, o2]);

    await service.acceptOffer(PASSENGER, "q1", "o1");
    await service.acceptOffer(PASSENGER, "q2", "o2");

    expect(store.trips).toHaveLength(2);
    expect(q1.tripId).not.toBe(q2.tripId);
    expect(o1.status).toBe("ACCEPTED");
    expect(o2.status).toBe("ACCEPTED");
  });

  it("uses a conditional quote update, never an unconditional one", async () => {
    const quote = makeQuote("q1");
    const offer = makeOffer("o1", "q1", "driver-1");
    const { service, prisma } = buildHarness([quote], [offer]);

    await service.acceptOffer(PASSENGER, "q1", "o1");

    const cas = (prisma.fareQuote as { updateMany: jest.Mock }).updateMany.mock
      .calls[0][0];
    expect(cas.where).toEqual({
      id: "q1",
      passengerId: PASSENGER,
      status: { in: ["QUOTED", "PROPOSED"] },
      tripId: null,
    });
    expect(cas.data.status).toBe("ACCEPTED");
  });

  it("claims the driver only from ONLINE", async () => {
    const quote = makeQuote("q1");
    const offer = makeOffer("o1", "q1", "driver-1");
    const { service, prisma } = buildHarness([quote], [offer]);

    await service.acceptOffer(PASSENGER, "q1", "o1");

    const claim = (prisma.driver as { updateMany: jest.Mock }).updateMany.mock
      .calls[0][0];
    expect(claim.where).toEqual({ id: "driver-1", availability: "ONLINE" });
    expect(claim.data).toEqual({ availability: "ON_TRIP" });
  });
});
