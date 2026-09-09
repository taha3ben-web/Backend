import { NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ScheduledTripsService } from "./scheduled-trips.service";
import { ScheduledTripsController } from "./scheduled-trips.controller";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ROLES_KEY } from "../../common/decorators/roles.decorator";
import { TRANSITIONS } from "../trips/trip-transitions";

/**
 * اختبارات انحدار لـ P0: إلغاء الرحلة المجدولة.
 *
 * هذه اختبارات وحدة بمحاكاة Prisma — لا تدّعي تنفيذًا متزامنًا حقيقيًا
 * على PostgreSQL. ما تثبته هو شكل الـ WHERE (الـ CAS) وأن فشل الـ CAS
 * لا يُنتج أي أثر جانبي.
 */

type UpdateManyArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

const OWNER = "passenger-1";
const TRIP = "trip-1";

function makeService(updateManyImpl: (args: UpdateManyArgs) => { count: number }) {
  const updateMany = jest.fn(updateManyImpl);
  const update = jest.fn();
  const create = jest.fn();
  const findUnique = jest.fn(async () => ({ id: TRIP, status: "CANCELLED" }));
  const findMany = jest.fn(async () => []);
  const prisma = {
    trip: { updateMany, update, create, findUnique, findMany },
    tripEvent: { create: jest.fn() },
    driver: { update: jest.fn(), updateMany: jest.fn() },
    coupon: { update: jest.fn() },
    couponRedemption: { update: jest.fn(), deleteMany: jest.fn() },
  } as unknown as ConstructorParameters<typeof ScheduledTripsService>[1];
  const cronLock = { runExclusive: jest.fn() } as never;
  const countryConfig = { currencyFor: jest.fn() } as never;
  const service = new ScheduledTripsService(cronLock, prisma, countryConfig);
  return { service, prisma: prisma as never as Record<string, any>, updateMany, update };
}

/** يحاكي صف رحلة واحد: يطابق شروط الـ WHERE فعليًا مثل قاعدة البيانات. */
function rowMatcher(row: {
  id: string;
  passengerId: string;
  isScheduled: boolean;
  status: string;
}) {
  return (args: UpdateManyArgs) => {
    const w = args.where;
    const ok =
      (w.id === undefined || w.id === row.id) &&
      (w.passengerId === undefined || w.passengerId === row.passengerId) &&
      (w.isScheduled === undefined || w.isScheduled === row.isScheduled) &&
      (w.status === undefined || w.status === row.status);
    return { count: ok ? 1 : 0 };
  };
}

describe("ScheduledTripsService.cancel — authorization + lifecycle CAS", () => {
  it("A1/B1: the owning passenger cancels their own SCHEDULED trip", async () => {
    const { service, updateMany } = makeService(
      rowMatcher({
        id: TRIP,
        passengerId: OWNER,
        isScheduled: true,
        status: "SCHEDULED",
      }),
    );
    await expect(service.cancel(TRIP, OWNER)).resolves.toBeTruthy();
    expect(updateMany).toHaveBeenCalledTimes(1);
    const args = updateMany.mock.calls[0][0] as UpdateManyArgs;
    // الـ CAS لا يكتمل إلا بأربعة شروط معًا.
    expect(args.where).toEqual({
      id: TRIP,
      passengerId: OWNER,
      isScheduled: true,
      status: "SCHEDULED",
    });
    expect(args.data).toEqual({
      status: "CANCELLED",
      cancelledBy: "PASSENGER",
    });
  });

  it("A2: a different passenger cannot cancel someone else's SCHEDULED trip", async () => {
    const { service } = makeService(
      rowMatcher({
        id: TRIP,
        passengerId: OWNER,
        isScheduled: true,
        status: "SCHEDULED",
      }),
    );
    await expect(service.cancel(TRIP, "passenger-2")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("A2b: the error does not disclose that another user's trip exists", async () => {
    const { service } = makeService(
      rowMatcher({
        id: TRIP,
        passengerId: OWNER,
        isScheduled: true,
        status: "SCHEDULED",
      }),
    );
    const missing = makeService(() => ({ count: 0 }));
    const foreign = await service.cancel(TRIP, "passenger-2").catch((e) => e);
    const absent = await missing.service
      .cancel("no-such-trip", "passenger-2")
      .catch((e) => e);
    // نفس النوع ونفس الرسالة — لا تمييز بين "مملوكة لغيرك" و"غير موجودة".
    expect(foreign.constructor).toBe(absent.constructor);
    expect(foreign.message).toBe(absent.message);
  });

  describe("B2-B6: no lifecycle state other than SCHEDULED can be overwritten", () => {
    for (const status of [
      "SEARCHING",
      "ACCEPTED",
      "ARRIVING",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
    ]) {
      it(`rejects a trip in ${status}`, async () => {
        const { service, updateMany } = makeService(
          rowMatcher({
            id: TRIP,
            passengerId: OWNER,
            isScheduled: true,
            status,
          }),
        );
        // حتى للمالك نفسه: الـ CAS يرفض لأن الحالة ليست SCHEDULED.
        await expect(service.cancel(TRIP, OWNER)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(updateMany.mock.results[0].value.count).toBe(0);
      });
    }
  });

  it("B6b: an already CANCELLED trip keeps its original attribution", async () => {
    const row = {
      id: TRIP,
      passengerId: OWNER,
      isScheduled: true,
      status: "CANCELLED",
      cancelledBy: "SYSTEM",
    };
    const { service } = makeService((args) => {
      const match = rowMatcher(row)(args);
      if (match.count === 1) Object.assign(row, args.data);
      return match;
    });
    await expect(service.cancel(TRIP, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(row.cancelledBy).toBe("SYSTEM");
  });

  it("B7: a non-scheduled trip is out of reach even in SCHEDULED-like state", async () => {
    const { service } = makeService(
      rowMatcher({
        id: TRIP,
        passengerId: OWNER,
        isScheduled: false,
        status: "SCHEDULED",
      }),
    );
    await expect(service.cancel(TRIP, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("C: a losing CAS performs no side effect at all", async () => {
    const { service, prisma, update } = makeService(() => ({ count: 0 }));
    await expect(service.cancel(TRIP, OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // لا حدث، لا تحرير سائق، لا قسيمة، ولا تحديث غير مشروط للرحلة.
    expect(update).not.toHaveBeenCalled();
    expect(prisma.tripEvent.create).not.toHaveBeenCalled();
    expect(prisma.driver.update).not.toHaveBeenCalled();
    expect(prisma.driver.updateMany).not.toHaveBeenCalled();
    expect(prisma.coupon.update).not.toHaveBeenCalled();
    expect(prisma.couponRedemption.update).not.toHaveBeenCalled();
    expect(prisma.couponRedemption.deleteMany).not.toHaveBeenCalled();
    // لا يوجد مُرسِل لحظي ولا خدمة مكالمات محقونة في هذه الخدمة أصلًا.
    expect(Object.keys(service as unknown as object)).not.toContain("realtime");
  });
});

describe("ScheduledTripsService.activateDueTripsTask — activation CAS", () => {
  function makeActivation(rows: Array<{ id: string; status: string }>) {
    const updateMany = jest.fn(async (args: UpdateManyArgs) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (!row || row.status !== args.where.status) return { count: 0 };
      row.status = String(args.data.status);
      return { count: 1 };
    });
    const prisma = {
      trip: {
        findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
        updateMany,
        update: jest.fn(),
      },
    } as unknown as ConstructorParameters<typeof ScheduledTripsService>[1];
    const service = new ScheduledTripsService(
      { runExclusive: jest.fn() } as never,
      prisma,
      { currencyFor: jest.fn() } as never,
    );
    return { service, rows, updateMany, prisma: prisma as never as Record<string, any> };
  }

  it("D1: activates a trip that is still SCHEDULED", async () => {
    const { service, rows } = makeActivation([{ id: "t1", status: "SCHEDULED" }]);
    await expect(service.activateDueTripsTask()).resolves.toEqual({
      activated: 1,
    });
    expect(rows[0].status).toBe("SEARCHING");
  });

  it("D2: a cancellation winning the race prevents CANCELLED -> SEARCHING", async () => {
    const rows = [{ id: "t1", status: "SCHEDULED" }];
    const { service, updateMany } = makeActivation(rows);
    // الإلغاء يقع بعد الـ SELECT وقبل الـ UPDATE.
    updateMany.mockImplementationOnce(async () => {
      rows[0].status = "CANCELLED";
      return { count: 0 };
    });
    await expect(service.activateDueTripsTask()).resolves.toEqual({
      activated: 0,
    });
    expect(rows[0].status).toBe("CANCELLED");
  });

  it("D3: the activation UPDATE always carries the expected-state predicate", async () => {
    const { service, updateMany } = makeActivation([
      { id: "t1", status: "SCHEDULED" },
    ]);
    await service.activateDueTripsTask();
    const args = updateMany.mock.calls[0][0] as UpdateManyArgs;
    expect(args.where).toEqual({ id: "t1", status: "SCHEDULED" });
    expect(args.data).toEqual({ status: "SEARCHING" });
  });

  it("D4: no unconditional trip.update remains on the activation path", async () => {
    const { service, prisma } = makeActivation([
      { id: "t1", status: "SCHEDULED" },
    ]);
    await service.activateDueTripsTask();
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("D5: a losing row does not stop the rest of the batch", async () => {
    const { service } = makeActivation([
      { id: "t1", status: "CANCELLED" },
      { id: "t2", status: "SCHEDULED" },
    ]);
    await expect(service.activateDueTripsTask()).resolves.toEqual({
      activated: 1,
    });
  });
});

describe("ScheduledTripsController.cancel — role metadata", () => {
  const reflector = new Reflector();

  it("A3/A4: the endpoint is restricted to PASSENGER", () => {
    const roles = reflector.get<string[]>(
      ROLES_KEY,
      ScheduledTripsController.prototype.cancel,
    );
    expect(roles).toEqual(["PASSENGER"]);
  });

  it("A3: RolesGuard rejects a DRIVER on this handler", () => {
    const guard = new RolesGuard(reflector);
    const ctx = {
      getHandler: () => ScheduledTripsController.prototype.cancel,
      getClass: () => ScheduledTripsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: "d1", role: "DRIVER" } }),
      }),
    } as never;
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it("A4: RolesGuard rejects STAFF on this handler", () => {
    const guard = new RolesGuard(reflector);
    const ctx = {
      getHandler: () => ScheduledTripsController.prototype.cancel,
      getClass: () => ScheduledTripsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: "s1", role: "STAFF" } }),
      }),
    } as never;
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it("A1: RolesGuard admits a PASSENGER and the id comes from the token, not the body", () => {
    const guard = new RolesGuard(reflector);
    const ctx = {
      getHandler: () => ScheduledTripsController.prototype.cancel,
      getClass: () => ScheduledTripsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: OWNER, role: "PASSENGER" } }),
      }),
    } as never;
    expect(guard.canActivate(ctx)).toBe(true);

    const service = { cancel: jest.fn() };
    const controller = new ScheduledTripsController(service as never);
    controller.cancel({ userId: OWNER, role: "PASSENGER" }, TRIP);
    expect(service.cancel).toHaveBeenCalledWith(TRIP, OWNER);
  });
});

describe("canonical state machine remains the source of truth", () => {
  it("F: COMPLETED and CANCELLED stay terminal", () => {
    expect(TRANSITIONS.COMPLETED).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
    expect(TRANSITIONS.SCHEDULED).toContain("CANCELLED");
  });
});
