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
    { key: "pricing.manage", description: "إدارة التسعير" },
    { key: "notifications.send", description: "إرسال الإشعارات" },
    { key: "support.manage", description: "إدارة الدعم والشكاوى" },
    { key: "reports.read", description: "التقارير والإحصائيات" },
    { key: "settings.manage", description: "إدارة الإعدادات" },
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
        "notifications.send",
        "reports.read",
        "funding.read",
        "funding.manage",
        "qr.read",
        "qr.manage",
        "transfer.read",
        "transfer.manage",
      ],
    },
    {
      name: "SUPPORT",
      description: "دعم فني",
      keys: ["support.manage", "passengers.read", "trips.read"],
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
        "funding.read",
        "funding.manage",
        "qr.read",
        "transfer.read",
        "transfer.manage",
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
  const adminLogin = "admin";
  const passwordHash = await bcrypt.hash("1234", 10);
  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: adminLogin },
        { phone: "0000000000" },
        { username: adminLogin },
        { username: "superadmin" },
        { email: "admin@novaride.app" },
      ],
    },
  });

  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        name: "Admin",
        username: adminLogin,
        phone: adminLogin,
        email: "admin@novaride.app",
        passwordHash,
        status: "ACTIVE",
        type: "STAFF",
        staffRoleId: superAdminRole?.id,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        name: "Admin",
        username: adminLogin,
        phone: adminLogin,
        email: "admin@novaride.app",
        passwordHash,
        type: "STAFF",
        status: "ACTIVE",
        staffRoleId: superAdminRole?.id,
      },
    });
  }

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
  }> = [
    {
      key: "app.general",
      group: "general",
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
      value: {
        primaryColor: "#0EA5E9",
        secondaryColor: "#111827",
        defaultMode: "light",
      },
    },
    {
      key: "app.legal",
      group: "legal",
      value: { privacyPolicyUrl: "", termsUrl: "" },
    },
    {
      key: "integrations.firebase",
      group: "integrations",
      value: { projectId: "", apiKey: "", messagingSenderId: "", appId: "" },
    },
    {
      key: "integrations.maps",
      group: "integrations",
      value: {
        provider: "osm",
        tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      },
    },
    {
      key: "integrations.notifications",
      group: "integrations",
      value: { fcmEnabled: false, smsEnabled: false, emailEnabled: false },
    },
    {
      key: "integrations.email",
      group: "integrations",
      value: { fromName: "NOVA Ride", fromEmail: "", apiUrl: "" },
    },
    {
      key: "integrations.sms",
      group: "integrations",
      value: { sender: "NOVA", apiUrl: "" },
    },
  ];
  for (const s of settingDefs) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { group: s.group },
      create: { key: s.key, group: s.group, value: s.value as object },
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
    "Seed done. Admin login -> username: admin / password: 1234",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
