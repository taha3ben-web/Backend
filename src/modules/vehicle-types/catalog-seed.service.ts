import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

const SEED_FLAG_KEY = "catalog_seeded";
// ترحيل لمرة واحدة: نشر الأنواع الموجودة مسبقًا (قبل إضافة دورة النشر) حتى لا تختفي عن الركاب.
const PUBLISH_BACKFILL_FLAG_KEY = "catalog_publish_backfill_v1";

/**
 * بذر تلقائي لبيانات افتراضية مرة واحدة فقط.
 * يعتمد على علامة في جدول Setting (وليس على كون الجدول فارغًا)：
 * إذا حذف المدير الأنواع بنفسه لا يُعاد إنشاؤها.
 */
@Injectable()
export class CatalogSeedService implements OnModuleInit {
  private readonly logger = new Logger(CatalogSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // (1) ترحيل النشر لمرة واحدة للأنظمة القائمة (يعمل حتى لو تمّ البذر سابقًا).
    await this.publishBackfill();
    // (2) البذر الافتراضي لمرة واحدة.
    try {
      const flag = await this.prisma.setting.findUnique({
        where: { key: SEED_FLAG_KEY },
      });
      if (flag) return; // تمّ البذر مسبقًا — لا تعدّ حتى لو حذف المدير كل شيء.
      this.logger.log("بذر الكتالوج الافتراضي لمرة واحدة...");
      await this.seed();
      await this.prisma.setting.create({
        data: { key: SEED_FLAG_KEY, value: true, group: "catalog" },
      });
    } catch (err) {
      // لا نوقف إقلاع الخادم إذا فشل البذر (مثلًا قبل db push).
      this.logger.warn(`تعذّر بذر الكتالوج: ${String(err)}`);
    }
  }

  /**
   * ترحيل لمرة واحدة: بعد إدخال دورة النشر (Workflow) صارت الأنواع الجديدة DRAFT افتراضيًا.
   * الأنواع الموجودة قبل هذا التحديث يجب أن تبقى ظاهرة للركاب، لذا ننشرها مرة واحدة فقط.
   */
  private async publishBackfill() {
    try {
      const flag = await this.prisma.setting.findUnique({
        where: { key: PUBLISH_BACKFILL_FLAG_KEY },
      });
      if (flag) return;
      const res = await this.prisma.vehicleType.updateMany({
        where: { status: "DRAFT", deletedAt: null },
        data: { status: "PUBLISHED" },
      });
      await this.prisma.setting.create({
        data: { key: PUBLISH_BACKFILL_FLAG_KEY, value: true, group: "catalog" },
      });
      if (res.count > 0) {
        this.logger.log(`تم نشر ${res.count} نوع مركبة موجود مسبقًا (ترحيل لمرة واحدة).`);
      }
    } catch (err) {
      this.logger.warn(`تعذّر ترحيل نشر الأنواع: ${String(err)}`);
    }
  }

  private async seed() {
    // ميزات مرنة افتراضية
    const featureDefs = [
      { code: "AC", name: "مكيف", iconValue: "\u2744\uFE0F" },
      { code: "FRIDGE", name: "براد", iconValue: "\uD83E\uDDCA" },
      { code: "WIFI", name: "واي فاي", iconValue: "\uD83D\uDCF6" },
      { code: "CHARGER", name: "شاحن", iconValue: "\uD83D\uDD0C" },
      { code: "CHILD_SEAT", name: "كرسي أطفال", iconValue: "\uD83D\uDC76" },
      { code: "ACCESSIBLE", name: "مناسب لذوي الاحتياجات الخاصة", iconValue: "\u267F" },
      { code: "PETS", name: "يسمح بالحيوانات", iconValue: "\uD83D\uDC3E" },
    ];
    const features: Record<string, string> = {};
    for (let i = 0; i < featureDefs.length; i++) {
      const f = featureDefs[i];
      const created = await this.prisma.feature.create({
        data: {
          code: f.code,
          name: f.name,
          iconType: "EMOJI",
          iconValue: f.iconValue,
          sortOrder: i + 1,
        },
      });
      features[f.code] = created.id;
    }

    // فئة السيارات
    const cars = await this.prisma.vehicleCategory.create({
      data: {
        name: "سيارات",
        nameI18n: { ar: "سيارات", fr: "Voitures", en: "Cars" },
        iconType: "EMOJI",
        iconValue: "\uD83D\uDE97",
        color: "#2563EB",
        usageType: "BOTH",
        sortOrder: 1,
      },
    });
    // فئة الدراجات
    const bikes = await this.prisma.vehicleCategory.create({
      data: {
        name: "دراجات",
        nameI18n: { ar: "دراجات", fr: "Motos", en: "Bikes" },
        iconType: "EMOJI",
        iconValue: "\uD83C\uDFCD\uFE0F",
        color: "#16A34A",
        usageType: "BOTH",
        sortOrder: 2,
      },
    });

    await this.createType(cars.id, {
      name: "اقتصادية",
      i18n: { ar: "اقتصادية", fr: "Économique", en: "Economy" },
      icon: "\uD83D\uDE97",
      capacity: 4,
      luggage: 2,
      sortOrder: 1,
      featureIds: [],
      price: { baseFare: 50, perKm: 25, perMin: 5, minFare: 100 },
    });
    await this.createType(cars.id, {
      name: "مريحة",
      i18n: { ar: "مريحة", fr: "Confort", en: "Comfort" },
      icon: "\uD83D\uDE99",
      capacity: 4,
      luggage: 3,
      sortOrder: 2,
      featureIds: [features.AC, features.CHARGER],
      price: { baseFare: 80, perKm: 35, perMin: 7, minFare: 150 },
    });
    await this.createType(cars.id, {
      name: "عائلية",
      i18n: { ar: "عائلية", fr: "Familiale", en: "Family" },
      icon: "\uD83D\uDE90",
      capacity: 7,
      luggage: 5,
      sortOrder: 3,
      featureIds: [features.AC, features.CHILD_SEAT],
      price: { baseFare: 120, perKm: 45, perMin: 9, minFare: 220 },
    });

    await this.createType(bikes.id, {
      name: "دراجة اقتصادية",
      i18n: { ar: "دراجة اقتصادية", fr: "Moto économique", en: "Economy bike" },
      icon: "\uD83C\uDFCD\uFE0F",
      capacity: 1,
      luggage: 0,
      sortOrder: 1,
      featureIds: [],
      price: { baseFare: 30, perKm: 15, perMin: 3, minFare: 60 },
    });
    await this.createType(bikes.id, {
      name: "دراجة توصيل",
      i18n: { ar: "دراجة توصيل", fr: "Moto livraison", en: "Delivery bike" },
      icon: "\uD83D\uDCE6",
      capacity: 1,
      luggage: 1,
      usageType: "DELIVERY",
      sortOrder: 2,
      featureIds: [],
      price: { baseFare: 40, perKm: 18, perMin: 2, minFare: 70 },
    });
  }

  private async createType(
    categoryId: string,
    t: {
      name: string;
      i18n: Record<string, string>;
      icon: string;
      capacity: number;
      luggage: number;
      usageType?: string;
      sortOrder: number;
      featureIds: string[];
      price: { baseFare: number; perKm: number; perMin: number; minFare: number };
    },
  ) {
    const type = await this.prisma.vehicleType.create({
      data: {
        categoryId,
        name: t.name,
        nameI18n: t.i18n,
        iconType: "EMOJI",
        iconValue: t.icon,
        capacity: t.capacity,
        luggage: t.luggage,
        usageType: t.usageType ?? "BOTH",
        status: "PUBLISHED",
        sortOrder: t.sortOrder,
      },
    });
    const featureIds = t.featureIds.filter(Boolean);
    if (featureIds.length) {
      await this.prisma.vehicleTypeFeature.createMany({
        data: featureIds.map((featureId) => ({ vehicleTypeId: type.id, featureId })),
        skipDuplicates: true,
      });
    }
    await this.prisma.vehiclePricingRule.create({
      data: {
        vehicleTypeId: type.id,
        name: "افتراضي",
        baseFare: t.price.baseFare,
        perKm: t.price.perKm,
        perMin: t.price.perMin,
        minFare: t.price.minFare,
        commissionPct: 15,
        currency: "DZD",
        priority: 0,
      },
    });
  }
}
