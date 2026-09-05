/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from "@nestjs/testing";
import { DriversModule } from "./drivers.module";
import { DriverSelfService } from "./driver-self.service";
import { TripsService } from "../trips/trips.service";

/**
 * إثبات حلّ رسم التبعيات: DriversModule → TripsModule → كامل الإغلاق.
 *
 * "nest build" لا يكفي: أخطاء الحاقن ("can't resolve dependencies" أو
 * "circular dependency detected") تقع وقت التشغيل ولا تظهر في الترجمة.
 *
 * compile() يبني الحاقن ويحلّ الرسم كاملاً دون استدعاء onModuleInit،
 * فلا اتصال بقاعدة بيانات ولا Redis ولا تسجيل مهام دورية ⇒ يعمل في CI.
 * useMocker يسدّ فقط البنية التحتية الخارجية (Prisma/Redis/الإعدادات) ولا يخفي
 * مشاكل تحميل الوحدات ولا الدورات: تلك تُفشل compile() مباشرةً.
 */
describe("DriversModule → TripsModule dependency closure", () => {
  it("يُحلّ بلا circular dependency وتُبنى الخدمتان الحقيقيتان", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DriversModule],
    })
      .useMocker(() => ({}))
      .compile();

    const driverSelf = moduleRef.get(DriverSelfService, { strict: false });
    const trips = moduleRef.get(TripsService, { strict: false });

    expect(driverSelf).toBeInstanceOf(DriverSelfService);
    expect(trips).toBeInstanceOf(TripsService);

    await moduleRef.close();
  }, 60000);

  it("يحقن نفس نسخة TripsService في الـadapter (لا نسختان من دورة الحياة)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DriversModule],
    })
      .useMocker(() => ({}))
      .compile();

    const driverSelf = moduleRef.get(DriverSelfService, { strict: false });
    const trips = moduleRef.get(TripsService, { strict: false });

    expect((driverSelf as any).tripsLifecycle).toBe(trips);

    await moduleRef.close();
  }, 60000);
});
