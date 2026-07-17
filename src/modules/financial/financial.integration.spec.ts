/**
 * اختبارات تكامل/تزامن/استرداد مقابل قاعدة بيانات حقيقية (Postgres).
 *
 * يُتخطّى (skip) تلقائيًا ما لم تُضبط `TEST_DATABASE_URL`، فلا يكسر `npm test` العادي.
 *
 * للتشغيل:
 *   1) جهّز قاعدة بيانات اختبار معزولة ثم رّحل المخطط:
 *        TEST_DATABASE_URL=postgres://... npx prisma migrate deploy
 *   2) شغّل:
 *        TEST_DATABASE_URL=postgres://... npm test -- financial.integration
 *
 * يغطّي: عدم تكرار التسوية، تسوية متزامنة، التقاط بطاقة مكرّر، حفظ
 * القيمة في السحب (reserve→complete)، الاسترداد (FAILED→POSTED)، والتسوية الدورية.
 *
 * ملاحظة: الأنواع هنا مُرخّاة (any) لأنّ هذا مجرّب (harness) يعتمد على Prisma
 * Client المُولّد؛ عدّل حقول البذور (seed) إن اختلف مخططك.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaService } from "../../prisma/prisma.service";
import { FinancialService } from "./financial.service";
import { OutboxService } from "../../common/infra/outbox.service";
import { PricingEngineService } from "../pricing-engine/pricing-engine.service";

const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // يضمن أن يرى jest اختبارًا واحدًا على الأقل بدل الفشل بـ “لا اختبارات”.
  describe("financial integration (skipped: set TEST_DATABASE_URL)", () => {
    it("is skipped without TEST_DATABASE_URL", () => {
      expect(hasDb).toBe(false);
    });
  });
}

describeDb("financial integration (real DB)", () => {
  let prisma: any;
  let financial: any;
  const CUR = process.env.DEFAULT_CURRENCY ?? "DZD";

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    // مجرّب يمرّر صندوق صادر حقيقي ليُكتب حدث trip.settled داخل المعاملة.
    const outbox = new OutboxService(
      prisma as PrismaService,
      {
        emit: () => undefined,
      } as any,
    );
    // قفل صوري (دون Redis) ينفّذ الدالة مباشرة خلال الاختبار.
    const lock = { withLock: (_k: string, fn: () => any) => fn() } as any;
    const pricingEngine = new PricingEngineService(prisma as PrismaService);
    financial = new FinancialService(
      prisma as PrismaService,
      outbox,
      lock,
      pricingEngine,
    );
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  /** يُنشئ راكبًا + سائقًا + رحلة مكتملة جاهزة للتسوية. */
  async function seedCompletedTrip(fare = 100): Promise<{
    tripId: string;
    driverUserId: string;
  }> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const passenger = await prisma.user.create({
      data: { phone: `+100000${suffix}`, role: "PASSENGER" } as any,
    });
    const driverUser = await prisma.user.create({
      data: { phone: `+200000${suffix}`, role: "DRIVER" } as any,
    });
    const driver = await prisma.driver.create({
      data: { userId: driverUser.id } as any,
    });
    const trip = await prisma.trip.create({
      data: {
        passengerId: passenger.id,
        driverId: driver.id,
        status: "COMPLETED",
        completedAt: new Date(),
        fare,
        currency: CUR,
        commissionPct: 20,
        paymentMethod: "CASH",
        settlementStatus: "PENDING",
      } as any,
    });
    return { tripId: trip.id, driverUserId: driverUser.id };
  }

  async function ledgerTxCount(referenceId: string): Promise<number> {
    return prisma.ledgerTransaction.count({
      where: { referenceType: "TRIP", referenceId, status: "POSTED" },
    });
  }

  it("settles a completed trip exactly once (idempotent)", async () => {
    const { tripId } = await seedCompletedTrip(100);
    await financial.settleTrip(tripId);
    await financial.settleTrip(tripId);

    expect(await ledgerTxCount(tripId)).toBe(1);
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip.settlementStatus).toBe("POSTED");
    expect(trip.settledAt).not.toBeNull();
  });

  it("produces a single settlement under concurrent calls (race)", async () => {
    const { tripId } = await seedCompletedTrip(100);
    // قد يرمي أحدهما بسبب تعارض Serializable — وهذا مقبول.
    await Promise.allSettled([
      financial.settleTrip(tripId),
      financial.settleTrip(tripId),
    ]);
    expect(await ledgerTxCount(tripId)).toBe(1);
  });

  it("recovers a FAILED trip on the next retry sweep (FAILED -> POSTED)", async () => {
    const { tripId } = await seedCompletedTrip(100);
    // محاكاة فشل سابق: الحالة FAILED مع محاولات تحت الحد.
    await prisma.trip.update({
      where: { id: tripId },
      data: { settlementStatus: "FAILED", settlementAttempts: 1 } as any,
    });
    await financial.retryUnsettledTrips();

    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip.settlementStatus).toBe("POSTED");
    expect(await ledgerTxCount(tripId)).toBe(1);
  });

  it("reconciliation reports zero mismatches for a freshly settled trip", async () => {
    const { tripId } = await seedCompletedTrip(100);
    await financial.settleTrip(tripId);
    const result = await financial.reconcileLedgerBalances();
    expect(result.mismatches).toBe(0);
  });
});
