import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import {
  ALGERIA_WILAYAS,
  assertWilayaDatasetIntegrity,
} from "./data/algeria-wilayas";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // ---------- الصلاحيات والأدوار (RBAC) ----------
  const permissionDefs: Array<{ key: string; description: string }> = [
    { key: "*", description: "كل الصلاحيات (مدير عام)" },
    { key: "drivers.read", description: "عرض السائقين" },
    { key: "drivers.manage", description: "إدارة السائقين" },
    { key: "drivers.documents", description: "مراجعة الوثائق" },
    { key: "passengers.read", description: "عرض الركاب" },
    { key: "passengers.manage", description: "إدارة الركاب" },
    { key: "trips.read", description: "عرض الرحلات" },
    { key: "trips.manage", description: "إدارة الرحلات" },
    { key: "payments.read", description: "عرض المدفوعات" },
    { key: "payments.manage", description: "إدارة المدفوعات والسحوبات" },
    { key: "funding.read", description: "عرض طلبات شحن السائقين" },
    { key: "funding.manage", description: "إدارة طلبات شحن السائقين" },
    { key: "qr.read", description: "عرض معرفات QR للسائقين" },
    { key: "qr.manage", description: "إدارة QR للسائقين" },
    { key: "transfer.read", description: "عرض تحويلات السائقين" },
    { key: "transfer.manage", description: "إدارة تحويلات السائقين" },
    { key: "coupons.manage", description: "إدارة الكوبونات" },
    // الرموز الترويجية (شحن المحفظة) — كانت مستعملة في PromoCodesController
    // لكنها لم تكن معرّفة هنا، فلم يكن ممكنًا منحها لأي دور غير المدير العام.
    { key: "promoCodes.manage", description: "إدارة الرموز الترويجية" },
    { key: "kyc.manage", description: "إدارة ومراجعة تحقق هوية المستخدمين" },
    { key: "subscriptions.manage", description: "إدارة الاشتراكات" },
    { key: "pricing.manage", description: "إدارة التسعير" },
    { key: "notifications.send", description: "إرسال الإشعارات" },
    { key: "support.manage", description: "إدارة الدعم والشكاوى" },
    { key: "safety.manage", description: "إدارة ملفات السلامة والطوارئ" },
    { key: "reports.read", description: "التقارير والإحصائيات" },
    { key: "settings.manage", description: "إدارة الإعدادات" },
    { key: "agents.manage", description: "إدارة حسابات الوكلاء" },
    { key: "staff.manage", description: "إدارة الموظفين والأدوار" },
    { key: "audit.read", description: "عرض السجلات" },
  ];
  for (const p of permissionDefs) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description },
      create: p,
    });
  }

  // ---------- khutat al-ishtirak al-iftiradiyya (tudar min lawhat al-tahakkum) ----------
  const planDefs = [
    {
      code: "NOVA_PLUS_MONTHLY",
      name: "NOVA Plus شهري",
      description: "خصم 10% على كل رحلة بحدّ أقصى 200.",
      price: 990,
      interval: "MONTHLY" as const,
      benefitDiscountPct: 10,
      benefitMaxDiscount: 200,
      sortOrder: 1,
    },
    {
      code: "NOVA_PLUS_YEARLY",
      name: "NOVA Plus سنوي",
      description: "خصم 12% على كل رحلة بحدّ أقصى 250.",
      price: 9900,
      interval: "YEARLY" as const,
      benefitDiscountPct: 12,
      benefitMaxDiscount: 250,
      sortOrder: 2,
    },
  ];
  for (const pl of planDefs) {
    await prisma.subscriptionPlan.upsert({
      where: { code: pl.code },
      update: {
        name: pl.name,
        description: pl.description,
        price: pl.price,
        interval: pl.interval,
        benefitDiscountPct: pl.benefitDiscountPct,
        benefitMaxDiscount: pl.benefitMaxDiscount,
        sortOrder: pl.sortOrder,
      },
      create: {
        code: pl.code,
        name: pl.name,
        description: pl.description,
        price: pl.price,
        interval: pl.interval,
        benefitDiscountPct: pl.benefitDiscountPct,
        benefitMaxDiscount: pl.benefitMaxDiscount,
        sortOrder: pl.sortOrder,
      },
    });
  }

  const roleDefs: Array<{
    name: string;
    description: string;
    keys: string[];
  }> = [
    { name: "SUPER_ADMIN", description: "مدير عام", keys: ["*"] },
    {
      name: "OPERATIONS",
      description: "مدير عمليات",
      keys: [
        "drivers.read",
        "drivers.manage",
        "passengers.read",
        "passengers.manage",
        "trips.read",
        "trips.manage",
        "pricing.manage",
        "coupons.manage",
        "promoCodes.manage",
        "subscriptions.manage",
        "kyc.manage",
        "notifications.send",
        "reports.read",
        "safety.manage",
        "funding.read",
        "funding.manage",
        "qr.read",
        "qr.manage",
        "transfer.read",
        "transfer.manage",
        "agents.manage",
      ],
    },
    {
      name: "SUPPORT",
      description: "دعم فني",
      keys: [
        "support.manage",
        "safety.manage",
        "passengers.read",
        "trips.read",
      ],
    },
    {
      name: "SUPERVISOR",
      description: "مشرف",
      keys: [
        "drivers.read",
        "passengers.read",
        "trips.read",
        "reports.read",
        "notifications.send",
        "funding.read",
        "qr.read",
        "transfer.read",
      ],
    },
    {
      name: "AGENT_DISPATCHER",
      description: "وكيل تشغيل",
      keys: [
        "passengers.read",
        "trips.read",
        "payments.read",
        "support.manage",
        "safety.manage",
        "funding.read",
        "funding.manage",
        "qr.read",
        "transfer.read",
        "transfer.manage",
        "agents.manage",
      ],
    },
    {
      name: "DOC_REVIEWER",
      description: "مراجع وثائق",
      keys: ["drivers.read", "drivers.documents"],
    },
  ];
  for (const r of roleDefs) {
    const perms = await prisma.permission.findMany({
      where: { key: { in: r.keys } },
      select: { id: true },
    });
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: { name: r.name, description: r.description },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  const superAdminRole = await prisma.role.findUnique({
    where: { name: "SUPER_ADMIN" },
  });

  // حساب مدير عام (STAFF) مربوط بدور SUPER_ADMIN
  const adminPhone = "0000000000";
  const adminUsername = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD ?? "admin1234", 10);
  await prisma.user.upsert({
    where: { phone: adminPhone },
    update: { username: adminUsername, staffRoleId: superAdminRole?.id },
    create: {
      name: "Super Admin",
      username: adminUsername,
      phone: adminPhone,
      email: "admin@novaride.app",
      passwordHash,
      type: "STAFF",
      status: "ACTIVE",
      staffRoleId: superAdminRole?.id,
    },
  });

  // ---------- المرحلة 8: الولايات الجزائرية الـ69 ----------
  // idempotent بالكامل: المفتاح هو number (الرقم الرسمي)، فإعادة التشغيل
  // تُحدّث الأسماء/الإحداثيات ولا تنشئ تكرارًا.
  //
  // ما لا يُلمس عند إعادة التشغيل: isOperational.
  // لماذا: هو قرار تجاري تتخذه الإدارة من اللوحة (أين يعمل flaminGO)،
  // وليس بيانًا مرجعيًا. دوسه هنا كان سيطفئ مناطق تشغيل حية عند كل نشر.
  assertWilayaDatasetIntegrity();
  for (const item of ALGERIA_WILAYAS) {
    await prisma.wilaya.upsert({
      where: { number: item.number },
      update: {
        code: item.code,
        nameAr: item.nameAr,
        nameFr: item.nameFr,
        nameEn: item.nameEn,
        seatAr: item.seatAr,
        seatFr: item.seatFr,
        centerLat: item.lat,
        centerLng: item.lng,
        isActive: true,
      },
      create: {
        number: item.number,
        code: item.code,
        nameAr: item.nameAr,
        nameFr: item.nameFr,
        nameEn: item.nameEn,
        seatAr: item.seatAr,
        seatFr: item.seatFr,
        centerLat: item.lat,
        centerLng: item.lng,
        isActive: true,
        isOperational: false,
      },
    });
  }
  console.log(`Wilayas seeded: ${ALGERIA_WILAYAS.length}`);

  const algiersWilaya = await prisma.wilaya.findUnique({
    where: { number: 16 },
  });

  // مدينة افتراضية + قاعدة تسعير
  const city = await prisma.city.upsert({
    where: { id: "seed-city-algiers" },
    // ربط المدينة الافتراضية بولايتها عند إعادة التشغيل أيضًا، لأن قواعد بيانات
    // موجودة من قبل المرحلة 8 فيها المدينة دون wilayaId.
    update: algiersWilaya ? { wilayaId: algiersWilaya.id } : {},
    create: {
      id: "seed-city-algiers",
      name: "Algiers",
      country: "DZ",
      centerLat: 36.7538,
      centerLng: 3.0588,
      wilayaId: algiersWilaya?.id ?? null,
    },
  });

  // الولاية التي نعمل فيها فعليًا عند أول تثبيت. تُفعّل مرة واحدة فقط عند الإنشاء
  // لكي لا يُعيد الـseed تفعيل ما عطّلته الإدارة عمدًا.
  if (algiersWilaya && !algiersWilaya.isOperational) {
    const anyOperational = await prisma.wilaya.count({
      where: { isOperational: true },
    });
    if (anyOperational === 0) {
      await prisma.wilaya.update({
        where: { id: algiersWilaya.id },
        data: { isOperational: true },
      });
    }
  }

  const existingRule = await prisma.pricingRule.findFirst({
    where: { cityId: city.id, rideClass: "ECONOMY" },
  });
  if (!existingRule) {
    await prisma.pricingRule.create({
      data: {
        cityId: city.id,
        rideClass: "ECONOMY",
        baseFare: 50,
        perKm: 20,
        perMin: 3,
        minFare: 100,
        currency: "DZD",
      },
    });
  }

  // إعدادات التطبيق (مجمّعة حسب group)
  const settingDefs: Array<{
    key: string;
    group: string;
    value: unknown;
    isPublic?: boolean;
    isSensitive?: boolean;
  }> = [
    {
      key: "app.general",
      group: "general",
      isPublic: true,
      value: {
        appName: "NOVA Ride",
        logoUrl: "",
        currency: "DZD",
        defaultLocale: "ar",
        supportedLocales: ["ar", "fr", "en"],
        countries: ["DZ"],
      },
    },
    {
      key: "app.theme",
      group: "appearance",
      isPublic: true,
      value: {
        primaryColor: "#0EA5E9",
        secondaryColor: "#111827",
        defaultMode: "light",
      },
    },
    {
      key: "app.legal",
      group: "legal",
      isPublic: true,
      value: { privacyPolicyUrl: "", termsUrl: "" },
    },
    {
      // رقم الطوارئ الظاهر في تطبيقَي الراكب والسائق.
      // لا رقم افتراضي مكتوب في الكود عمدًا: القيمة فارغة و enabled=false حتى
      // تضبطها الإدارة من لوحة التحكم (الإعدادات). ما دامت فارغة يختفي زر
      // الاتصال في التطبيقات بدل أن يتصل برقم مخترع.
      // ملاحظة: هذا رقم اتصال هاتفي مباشر فقط، ولا علاقة له بزر SOS الذي
      // يمرّ دائمًا عبر POST /safety/incidents.
      key: "safety.emergency",
      group: "safety",
      isPublic: true,
      value: { enabled: false, phone: "", label: "" },
    },
    {
      // سياسة التواصل بين الراكب والسائق (دردشة الرحلة + زر الاتصال).
      //
      // سبب وجود هذا المفتاح: TripCommunicationService يقرأ
      // settings.getValue("passenger.tripCommunication") ويشترط
      // policy.enabled === true. وبدون صفّ في جدول Setting كانت الدالة تُرجع
      // undefined، فتصبح active=false و canChat=false دائمًا — أي أن دردشة
      // الرحلة كانت معطّلة كليًا رغم اكتمال الواجهات والـ socket.
      //
      // phoneMode: "HIDDEN" افتراضيًا عن قصد. لا نكشف رقم أي طرف قبل قرار
      // إداري صريح، ولا نضع رقم جسر (bridgeNumber) مخترعًا. تفعيل الاتصال
      // يتم من لوحة التحكم، أو عبر مزوّد الإخفاء الحقيقي
      // (CALL_MASKING_PROVIDER=twilio) الذي لا يكشف أي رقم.
      key: "passenger.tripCommunication",
      group: "passenger",
      value: {
        enabled: true,
        chatEnabled: true,
        callEnabled: false,
        phoneMode: "HIDDEN",
        bridgeNumber: "",
        // الحالات التي تُعتبر فيها الرحلة قائمة، فتُفتح الدردشة.
        // بعد COMPLETED/CANCELLED تُغلق تلقائيًا (يبقى السجل للقراءة).
        // المرحلة 9: أُزيل "ARRIVED" — لا وجود له في enum TripStatus (الوصول
        // تمثّله ARRIVING). كان سلسلة ميتة لا تطابق أي حالة رحلة حقيقية.
        activeStatuses: ["ACCEPTED", "ARRIVING", "IN_PROGRESS"],
        // حد الإرسال لكل مستخدم داخل الرحلة الواحدة (مكافحة الإغراق).
        rateLimitPerMinute: 20,
      },
    },
    {
      // رسوم الأجرة المركزية (المرحلة 7): رسوم الخدمة والانتظار والإلغاء.
      // تُدار حصرًا من لوحة التحكم (Pricing ← رسوم الأجرة) عبر GET/PATCH /pricing/fees،
      // ويقرأها PricingPolicyService ثم تدخل في حساب الأجرة عبر fare-breakdown.util.ts.
      // كل ��لقيم أصفار/معطّلة افتراضيًا: لا نفرض رسومًا لم تقررها الإدارة.
      key: "pricing.fees",
      group: "pricing",
      value: {
        serviceFee: 0,
        waiting: {
          enabled: false,
          freeSeconds: 300,
          perMinute: 0,
          maxCharge: null,
        },
        cancellation: {
          enabled: false,
          graceSeconds: 120,
          feeAfterAccept: 0,
          feeAfterArrival: 0,
          driverCompensationPct: 0,
        },
        // حدود التفاوض: كانت في متغير بيئة (FARE_QUOTE_BAND_PCT) غير قابل للضبط
        // من اللوحة؛ أصبحت هنا ليكون مركز التسعير واحدًا. 0.2 = ±20%.
        negotiation: {
          bandPct: 0.2,
        },
      },
    },
    {
      // نسبة غرامة إلغاء السائق (%) من قيمة الرحلة الملغاة، تُحسم تلقائيًا من محفظة السائق.
      // 0 = الميزة معطّلة. قابلة للضبط من لوحة التحكم (الإعدادات).
      // ملاحظة: هذه غرامة على السائق، وتختلف عن pricing.fees.cancellation
      // التي هي رسم إلغاء على الراكب.
      key: "trips.driverCancellationPenaltyPct",
      group: "trips",
      value: { pct: 20 },
    },
    {
      // D-4 — مخاطر إلغاء الراكب. **لا توجد أي غرامة مالية على الراكب**؛
      // البديل هو تحذير ثم تجميد تلقائي للحساب (فك التجميد من لوحة التحكم فقط).
      // windowDays: النافذة المتدحرجة | warnThreshold: عتبة التحذير
      // freezeThreshold: عتبة التجميد (0 = معطّل) | countOnlyAfterAccept: لا تُحسب
      // الإلغاءات قبل قبول السائق.
      key: "trips.passengerCancellationRisk",
      group: "trips",
      value: {
        enabled: true,
        windowDays: 30,
        warnThreshold: 2,
        freezeThreshold: 3,
        countOnlyAfterAccept: true,
      },
    },
    {
      // D-6 — حماية وقت الانتظار: لا يُسمح بتسجيل ARRIVING إلا داخل
      // radiusMeters من نقطة الالتقاء، باعتماد موقع السائق المحفوظ على الخادم.
      // blockWhenLocationMissing: true = fail-closed (غياب GPS أو موقع قديم يمنع
      // تسجيل الوصول) — قرار معتمد لمنع التلاعب بزمن الانتظار.
      key: "trips.arrivalGeofence",
      group: "trips",
      value: {
        enabled: true,
        radiusMeters: 200,
        maxLocationAgeSeconds: 120,
        blockWhenLocationMissing: true,
      },
    },
    {
      // نظام عقوبات إلغاء السائق (كما في الشركات الكبرى): تصعيد تحذير/تعليق/حظر.
      // enabled=false افتراضيًا (آمن) — يُفعّل ويُضبط من لوحة التحكم (الإعدادات).
      // windowDays: النافذة المتدحرجة بالأيام؛ العتبات = عدد الإلغاءات؛ suspendHours = مدة التعليق.
      key: "trips.driverCancellationSanctions",
      group: "trips",
      value: {
        enabled: false,
        windowDays: 7,
        warnThreshold: 3,
        suspendThreshold: 5,
        suspendHours: 24,
        banThreshold: 10,
      },
    },
    {
      key: "integrations.firebase",
      group: "integrations",
      isSensitive: true,
      value: { projectId: "", apiKey: "", messagingSenderId: "", appId: "" },
    },
    {
      key: "integrations.maps",
      group: "integrations",
      isPublic: true,
      value: {
        provider: "osm",
        tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      },
    },
    {
      key: "integrations.notifications",
      group: "integrations",
      isPublic: true,
      value: { fcmEnabled: false, smsEnabled: false, emailEnabled: false },
    },
    {
      key: "integrations.email",
      group: "integrations",
      isSensitive: true,
      value: { fromName: "NOVA Ride", fromEmail: "", apiUrl: "" },
    },
    {
      key: "integrations.sms",
      group: "integrations",
      isSensitive: true,
      value: { sender: "NOVA", apiUrl: "" },
    },
    {
      // سياسة تمويل خصومات الكوبونات (قابلة للإدارة بالكامل من لوحة التحكم).
      // source: PLATFORM=الشركة تتحمّل كامل الخصم من عمولتها (قد تصبح سالبة)،
      // DRIVER=السائق يتحمّله، SHARED=مشترك بحصة platformShare (0..1).
      // لكل كوبون تجاوز هذا الافتراضي عبر fundingSource/platformShare.
      key: "coupons.funding",
      group: "coupons",
      value: { source: "PLATFORM", platformShare: 0.5 },
    },
  ];
  for (const s of settingDefs) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {
        group: s.group,
        isPublic: s.isPublic ?? false,
        isSensitive: s.isSensitive ?? false,
      },
      create: {
        key: s.key,
        group: s.group,
        value: s.value as object,
        isPublic: s.isPublic ?? false,
        isSensitive: s.isSensitive ?? false,
      },
    });
  }

  // منطقة افتراضية داخل المدينة
  const existingZone = await prisma.zone.findFirst({
    where: { cityId: city.id },
  });
  if (!existingZone) {
    await prisma.zone.create({
      data: { cityId: city.id, name: "وسط المدينة" },
    });
  }

  console.log(
    "Seed done. Admin login -> phone: 0000000000 / password: admin1234",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
