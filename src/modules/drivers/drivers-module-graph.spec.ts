/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
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

/**
 * مفاتيح الإعدادات التي يقرأها هذا الرسم فعلًا **وقت البناء** — مُثبتة من
 * الكود الحقيقي لا بالتخمين:
 * - "jwt.accessSecret" ← JwtStrategy.constructor يمرّرها إلى
 *   super({ secretOrKey: config.get<string>("jwt.accessSecret") }).
 *
 * باقي مستهلكي ConfigService داخل هذا الإغلاق يقرأون داخل الدوال لا في
 * المنشئ (FirebaseAdminService.ensureInit، SmsProvider.cfg)، وOtpService/
 * LoginThrottleService يقرأون process.env مباشرةً ⇒ لا مفاتيح إضافية
 * مطلوبة لبناء الرسم. أي مفتاح جديد يُضاف هنا فقط إذا أثبته الكود/الأثر.
 */
const CONFIG_VALUES: Record<string, unknown> = {
  "jwt.accessSecret": "test-jwt-access-secret",
};

/**
 * بديل ConfigService يحترم العقد الفعلي get<T>(key): T بدل كائن فارغ `{}`.
 * الكائن الفارغ هو ما سبّب TypeError: config.get is not a function.
 */
const configServiceDouble = {
  get: <T>(key: string): T | undefined => CONFIG_VALUES[key] as T | undefined,
};

/**
 * mocker واعٍ بالرمز: ConfigService يحصل على بديل مطابق للعقد، وبقية الرموز
 * غير المحلولة (بنية تحتية خارجية: Prisma/Redis/Storage…) تبقى كائنات فارغة.
 * لا يُستخدم لتعطيل بناء التبعيات الحقيقية: خدمات الوحدات نفسها تُبنى فعليًا.
 */
const mockInfrastructure = (token: unknown): unknown =>
  token === ConfigService ? configServiceDouble : {};

describe("DriversModule → TripsModule dependency closure", () => {
  it("يُحلّ بلا circular dependency وتُبنى الخدمتان الحقيقيتان", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DriversModule],
    })
      .useMocker(mockInfrastructure)
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
      .useMocker(mockInfrastructure)
      .compile();

    const driverSelf = moduleRef.get(DriverSelfService, { strict: false });
    const trips = moduleRef.get(TripsService, { strict: false });

    expect((driverSelf as any).tripsLifecycle).toBe(trips);

    await moduleRef.close();
  }, 60000);
});
