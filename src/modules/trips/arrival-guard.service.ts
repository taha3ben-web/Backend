import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { haversineMeters } from "../geo/geo.util";
import { CancellationPolicyService } from "./cancellation-policy.service";

/**
 * D-6 — حماية وقت الانتطار.
 *
 * لا يُسمح بتسجيل ARRIVING إلا إذا كان السائق فعليًا داخل نصف قطر مضبوط من
 * لوحة التحكم من نقطة الالتقاء.
 *
 * مصدر الموقع: الموقع المحفوط على الخادم في Redis (driver:<userId>) الذي يُكتب
 * عبر مسار تحديث الموقع المعتاد، **وليس** إحداثيات ترد في طلب تغيير الحالة،
 * حتى لا يمكن تجاوز الحماية بإرسال إحداثيات مزيفة.
 *
 * القرار النهائي المعتمد: **fail-closed** — إن لم يوجد موقع على الخادم أو كان
 * أقدم من maxLocationAgeSeconds يُرفض تسجيل الوصول، لأن الهدف منع التلاعب
 * بزمن الانتطار (وزمن الانتطار مالي: يدخل في الأجرة عبر buildFareBreakdown).
 *
 * لا تُكسر أي حالة قائمة: الحراسة تعمل فقط على الانتقال إلى ARRIVING، ولا تمسّ
 * IN_PROGRESS أو COMPLETED أو CANCELLED.
 */

export const ARRIVAL_REJECTED_EVENT = "arrival:rejected_far";
export const ARRIVAL_LOCATION_MISSING_EVENT = "arrival:location_missing";

@Injectable()
export class ArrivalGuardService {
  private readonly logger = new Logger(ArrivalGuardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly policy: CancellationPolicyService,
  ) {}

  /** موقع السائق المحفوط على الخادم (لا من طلب السائق). */
  private async serverLocation(
    driverUserId: string,
  ): Promise<{ lat: number; lng: number; ageSeconds: number } | null> {
    try {
      const raw = await this.redis.client.hgetall(`driver:${driverUserId}`);
      if (!raw) return null;
      const lat = Number(raw.lat);
      const lng = Number(raw.lng);
      const ts = Number(raw.ts);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const ageSeconds = Number.isFinite(ts)
        ? Math.max(0, Math.floor((Date.now() - ts) / 1000))
        : Number.POSITIVE_INFINITY;
      return { lat, lng, ageSeconds };
    } catch (error) {
      this.logger.warn(
        `Failed to read server location for driver ${driverUserId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * نوع meta هو Prisma.InputJsonObject وليس Record<string, unknown>: حقل
   * TripEvent.meta في المخطّط من نوع Json?، ومدخل Prisma لا يقبل unknown.
   * هذا هو النوع الصحيح فعليًا (قيم JSON فقط)، وليس تمويهًا للمدقق.
   */
  private async logEvent(
    tripId: string,
    type: string,
    meta: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.tripEvent
      .create({ data: { tripId, type, actor: "SYSTEM", meta } })
      .catch(() => undefined);
  }

  /**
   * يرمي ForbiddenException برسالة عربية واضحة إن لم يكن مسموحًا تسجيل الوصول.
   * تطبيق السائق يعرض رسالة الخادم كما هي (مصدر الحقيقة واحد).
   */
  async assertCanMarkArriving(input: {
    tripId: string;
    driverUserId: string;
    pickupLat: number | null | undefined;
    pickupLng: number | null | undefined;
  }): Promise<void> {
    const policy = await this.policy.arrivalGeofence();
    if (!policy.enabled) return;

    const pickupLat = Number(input.pickupLat);
    const pickupLng = Number(input.pickupLng);
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      // لا توجد نقطة التقاء موطّنة — لا يجوز معاقبة السائق على نقص بيانات الرحلة.
      await this.logEvent(input.tripId, ARRIVAL_LOCATION_MISSING_EVENT, {
        reason: "pickup_coordinates_missing",
        allowed: true,
      });
      return;
    }

    const location = await this.serverLocation(input.driverUserId);
    if (!location || location.ageSeconds > policy.maxLocationAgeSeconds) {
      await this.logEvent(input.tripId, ARRIVAL_LOCATION_MISSING_EVENT, {
        reason: location ? "location_stale" : "location_missing",
        ageSeconds: location?.ageSeconds ?? null,
        maxLocationAgeSeconds: policy.maxLocationAgeSeconds,
        blocked: policy.blockWhenLocationMissing,
      });
      if (!policy.blockWhenLocationMissing) return;
      throw new ForbiddenException(
        "\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0648\u0635\u0648\u0644: \u0645\u0648\u0642\u0639\u0643 \u063a\u064a\u0631 \u0645\u062a\u0648\u0641\u0631 \u0639\u0644\u0649 \u0627\u0644\u062e\u0627\u062f\u0645 \u0623\u0648 \u0642\u062f\u064a\u0645. \u0641\u0639\u0651\u0644 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0645\u0648\u0642\u0639 (GPS) \u0648\u062a\u0623\u0643\u062f \u0645\u0646 \u0627\u062a\u0635\u0627\u0644 \u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a \u062b\u0645 \u0623\u0639\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629.",
      );
    }

    const distance = Math.round(
      haversineMeters(
        { lat: location.lat, lng: location.lng },
        { lat: pickupLat, lng: pickupLng },
      ),
    );
    if (distance > policy.radiusMeters) {
      await this.logEvent(input.tripId, ARRIVAL_REJECTED_EVENT, {
        distanceMeters: distance,
        radiusMeters: policy.radiusMeters,
        locationAgeSeconds: location.ageSeconds,
      });
      throw new ForbiddenException(
        `\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0648\u0635\u0648\u0644: \u0645\u0627 \u0632\u0644\u062a \u0639\u0644\u0649 \u0645\u0633\u0627\u0641\u0629 ${distance} \u0645\u062a\u0631 \u0645\u0646 \u0646\u0642\u0637\u0629 \u0627\u0644\u0627\u0644\u062a\u0642\u0627\u0621 (\u0627\u0644\u0645\u0633\u0645\u0648\u062d ${policy.radiusMeters} \u0645\u062a\u0631). \u0627\u0642\u062a\u0631\u0628 \u0645\u0646 \u0627\u0644\u0631\u0627\u0643\u0628 \u062b\u0645 \u0623\u0639\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629.`,
      );
    }
  }
}
