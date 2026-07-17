import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { containsPoint } from "./geofence.util";

/**
 * خدمة الاحتواء الجغرافي: تحسم أي الأحياء (Zones) ومناطق الخدمة
 * (ServiceAreas) تحتوي نقطة معيّنة، اعتمادًا على مضلعات GeoJSON المخزّنة.
 * لا تغيّر أي مخطط ولا تمسّ المطابقة/التسعير.
 */
@Injectable()
export class GeofenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** الأحياء (Zones) التي تحتوي النقطة، ضمن مدينة اختيارية. */
  async resolveZones(lat: number, lng: number, cityId?: string) {
    const zones = await this.prisma.zone.findMany({
      where: cityId ? { cityId } : {},
      select: { id: true, name: true, cityId: true, polygon: true },
    });
    return zones
      .filter((z) => z.polygon != null && containsPoint(z.polygon, lat, lng))
      .map((z) => ({ id: z.id, name: z.name, cityId: z.cityId }));
  }

  /** مناطق الخدمة الفعّالة التي تحتوي النقطة. */
  async resolveServiceAreas(lat: number, lng: number) {
    const areas = await this.prisma.serviceArea.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, city: true, geojson: true },
    });
    return areas
      .filter((a) => a.geojson != null && containsPoint(a.geojson, lat, lng))
      .map((a) => ({ id: a.id, name: a.name, city: a.city ?? null }));
  }

  /** حسم كامل: الأحياء ومناطق الخدمة المحتوية للنقطة. */
  async resolvePoint(lat: number, lng: number, cityId?: string) {
    const [zones, serviceAreas] = await Promise.all([
      this.resolveZones(lat, lng, cityId),
      this.resolveServiceAreas(lat, lng),
    ]);
    return {
      point: { lat, lng },
      zones,
      serviceAreas,
      serviceable: serviceAreas.length > 0,
    };
  }

  /** فحص خفيف: هل النقطة ضمن منطقة خدمة فعّالة؟ */
  async checkServiceable(lat: number, lng: number) {
    const serviceAreas = await this.resolveServiceAreas(lat, lng);
    return { serviceable: serviceAreas.length > 0, areas: serviceAreas };
  }
}
