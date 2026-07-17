import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

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

  // مدينة افتراضية + قاعدة تسعير
  const city = await prisma.city.upsert({
    where: { id: "seed-city-algiers" },
    update: {},
    create: {
      id: "seed-city-algiers",
      name: "Algiers",
      country: "DZ",
      centerLat: 36.7538,
      centerLng: 3.0588,
    },
  });

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
      // نسبة غرامة إلغاء السائق (%) من قيمة الرحلة الملغاة، تُحسم تلقائيًا من محفظة السائق.
      // 0 = الميزة معطّلة. قابلة للضبط من لوحة التحكم (الإعدادات).
      key: "trips.driverCancellationPenaltyPct",
      group: "trips",
      value: { pct: 0 },
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
