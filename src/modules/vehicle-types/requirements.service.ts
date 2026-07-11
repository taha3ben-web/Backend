import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface RequirementCheck {
  key: string;
  label: string;
  required: unknown;
  actual: unknown;
  ok: boolean;
}

export interface RequirementResult {
  vehicleTypeId: string;
  driverId: string;
  eligible: boolean;
  checks: RequirementCheck[];
}

/**
 * خدمة التحقق من متطلبات نوع المركبة تلقائيًا: تقييم/رحلات/سنة الصنع/
 * رخصة/مستندات وصور إلزامية. تُرجع تقريرًا مفصّلًا لكل شرط.
 */
@Injectable()
export class RequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(vehicleTypeId: string, driverId: string): Promise<RequirementResult> {
    const type = await this.prisma.vehicleType.findUnique({
      where: { id: vehicleTypeId },
      select: {
        id: true,
        minVehicleYear: true,
        minDriverRating: true,
        minDriverTrips: true,
        requiredLicenseType: true,
        requiredDocuments: true,
        requiredPhotos: true,
      },
    });
    if (!type) throw new NotFoundException("نوع المركبة غير موجود");

    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        rating: true,
        totalTrips: true,
        vehicles: {
          where: { isActive: true },
          select: { year: true, vehicleTypeId: true },
        },
        documents: { select: { type: true, status: true } },
      },
    });
    if (!driver) throw new NotFoundException("السائق غير موجود");

    const checks: RequirementCheck[] = [];
    const approvedDocTypes = new Set(
      driver.documents.filter((d) => d.status === "APPROVED").map((d) => d.type),
    );

    if (type.minDriverRating != null) {
      checks.push({
        key: "minDriverRating",
        label: "الحد الأدنى للتقييم",
        required: type.minDriverRating,
        actual: driver.rating,
        ok: driver.rating >= type.minDriverRating,
      });
    }
    if (type.minDriverTrips != null) {
      checks.push({
        key: "minDriverTrips",
        label: "الحد الأدنى للرحلات",
        required: type.minDriverTrips,
        actual: driver.totalTrips,
        ok: driver.totalTrips >= type.minDriverTrips,
      });
    }
    if (type.minVehicleYear != null) {
      const years = driver.vehicles
        .map((v) => v.year)
        .filter((y): y is number => y != null);
      const bestYear = years.length ? Math.max(...years) : null;
      checks.push({
        key: "minVehicleYear",
        label: "الحد الأدنى لسنة الصنع",
        required: type.minVehicleYear,
        actual: bestYear,
        ok: bestYear != null && bestYear >= type.minVehicleYear,
      });
    }
    if (type.requiredLicenseType) {
      checks.push({
        key: "requiredLicenseType",
        label: "رخصة قيادة معتمدة",
        required: type.requiredLicenseType,
        actual: approvedDocTypes.has("LICENSE") ? "LICENSE" : null,
        ok: approvedDocTypes.has("LICENSE"),
      });
    }
    for (const doc of type.requiredDocuments ?? []) {
      checks.push({
        key: `document:${doc}`,
        label: `مستند إلزامي: ${doc}`,
        required: doc,
        actual: approvedDocTypes.has(doc) ? "APPROVED" : null,
        ok: approvedDocTypes.has(doc),
      });
    }
    for (const photo of type.requiredPhotos ?? []) {
      checks.push({
        key: `photo:${photo}`,
        label: `صورة إلزامية: ${photo}`,
        required: photo,
        actual: approvedDocTypes.has(photo) ? "APPROVED" : null,
        ok: approvedDocTypes.has(photo),
      });
    }

    return {
      vehicleTypeId,
      driverId,
      eligible: checks.every((c) => c.ok),
      checks,
    };
  }
}
