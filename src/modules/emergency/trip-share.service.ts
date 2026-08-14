import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { SHAREABLE_TRIP_STATUSES } from "../trips/trip-transitions";

/**
 * مشاركة الرحلة (Share my trip) — ميزة سلامة أساسية في Uber/Bolt/Heetch:
 * يُولّد الراكب رابطًا مؤقّتًا يُرسله لأهله، فيتابعون موقع السيارة دون حساب.
 *
 * قرارات أمنية:
 *  - الرمز عشوائي 32 بايت، ويُخزّن **مجزّأً (SHA-256)** فقط، فتسريب قاعدة
 *    البيانات لا يكشف مواقع الركّاب.
 *  - العرض العام يُرجع الحد الأدنى: لا رقم هاتف راكب، ولا أجرة، ولا معرّفات داخلية.
 *  - الرابط ينتهي تلقائيًا، ويمكن إبطاله يدويًا، ويتوقف بعد انتهاء الرحلة.
 */

/** مدّة صلاحية الرابط الافتراضية (دقائق). */
export const SHARE_DEFAULT_TTL_MIN = 240;
export const SHARE_MAX_TTL_MIN = 720;

/**
 * حالات الرحلة التي تسمح بإنشاء رابط متابعة.
 *
 * إصلاح المرحلة 9 (عيب سلامة حقيقي): كانت القائمة مكتوبة نصًّا هنا وتحوي
 * "ARRIVED" و"ONGOING" وهما غير موجودين في enum TripStatus، بينما سقطت
 * الحالتان الحقيقيتان ARRIVING وIN_PROGRESS. النتيجة: كان الراكب يُمنع من
 * مشاركة رحلته في اللحظة التي يحتاجها فعلًا — أثناء وصول السائق وأثناء سير
 * الرحلة — مع رسالة مضلّلة "لا يمكن مشاركة رحلة منتهية".
 * المصدر الآن موحَّد في trip-transitions ومُقيَّد بالنوع TripStatus[].
 */
export { SHAREABLE_TRIP_STATUSES };

/** يجزئ الرمز (دالة نقية قابلة للاختبار). */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** يبني رابط المشاركة الكامل من الرمز. */
export function buildShareUrl(token: string): string {
  const base = (
    process.env.PUBLIC_SHARE_BASE_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    ""
  ).replace(/\/+$/, "");
  return base ? `${base}/t/${token}` : `/api/safety/share/${token}`;
}

@Injectable()
export class TripShareService {
  constructor(private readonly prisma: PrismaService) {}

  /** يُنشئ (أو يُجدّد) رابط متابعة لرحلة يملكها المستخدم. */
  async create(userId: string, tripId: string, ttlMinutes?: number) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        id: tripId,
        OR: [{ passengerId: userId }, { driver: { userId } }],
      },
      select: { id: true, status: true },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (!SHAREABLE_TRIP_STATUSES.includes(trip.status as never)) {
      throw new BadRequestException("لا يمكن مشاركة رحلة منتهية");
    }

    const minutes = Math.min(
      SHARE_MAX_TTL_MIN,
      Math.max(5, ttlMinutes ?? SHARE_DEFAULT_TTL_MIN),
    );
    const token = randomBytes(32).toString("base64url");
    const record = await this.prisma.tripShareToken.create({
      data: {
        tripId,
        createdById: userId,
        tokenHash: hashShareToken(token),
        expiresAt: new Date(Date.now() + minutes * 60_000),
      },
      select: { id: true, expiresAt: true },
    });

    // الرمز الخام يُعاد مرّة واحدة فقط — لا يمكن استرجاعه لاحقًا.
    return {
      id: record.id,
      token,
      url: buildShareUrl(token),
      expiresAt: record.expiresAt,
    };
  }

  /** يسرد روابط المشاركة النشطة لرحلة (بلا رموز). */
  async listForTrip(userId: string, tripId: string) {
    return this.prisma.tripShareToken.findMany({
      where: {
        tripId,
        createdById: userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        expiresAt: true,
        viewCount: true,
        lastViewedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** يُبطل رابطًا فورًا. */
  async revoke(userId: string, id: string) {
    const found = await this.prisma.tripShareToken.findFirst({
      where: { id, createdById: userId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException("رابط المشاركة غير موجود");
    await this.prisma.tripShareToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  /**
   * عرض عام بالرمز: يُرجع حالة الرحلة وآخر موقع ومسارها فقط.
   * يُرمى 404 في كل حالات الفشل (منتهٍ/مُبطَل/غير موجود) حتّى لا يُستدلّ على وجود رموز.
   */
  async publicView(token: string) {
    const record = await this.prisma.tripShareToken.findUnique({
      where: { tokenHash: hashShareToken(token) },
      select: { id: true, tripId: true, expiresAt: true, revokedAt: true },
    });
    const now = new Date();
    if (!record || record.revokedAt || record.expiresAt <= now) {
      throw new NotFoundException("الرابط غير صالح أو منتهٍ");
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: record.tripId },
      select: {
        status: true,
        pickupAddress: true,
        destAddress: true,
        pickupLat: true,
        pickupLng: true,
        destLat: true,
        destLng: true,
        routePolyline: true,
        completedAt: true,
        driver: {
          select: {
            user: { select: { name: true } },
            vehicles: {
              where: { isActive: true },
              take: 1,
              select: { plate: true, color: true, make: true, model: true },
            },
          },
        },
        tracking: {
          orderBy: { recordedAt: "desc" },
          take: 1,
          select: { lat: true, lng: true, heading: true, recordedAt: true },
        },
      },
    });
    if (!trip) throw new NotFoundException("الرابط غير صالح أو منتهٍ");

    // عدّاد المشاهدات بأفضل جهد — لا يعطّل العرض إن فشل.
    void this.prisma.tripShareToken
      .update({
        where: { id: record.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: now },
      })
      .catch(() => undefined);

    const vehicle = trip.driver?.vehicles?.[0];
    return {
      status: trip.status,
      pickup: {
        lat: trip.pickupLat,
        lng: trip.pickupLng,
        address: trip.pickupAddress,
      },
      destination: {
        lat: trip.destLat,
        lng: trip.destLng,
        address: trip.destAddress,
      },
      routePolyline: trip.routePolyline,
      driver: trip.driver ? { name: trip.driver.user?.name ?? null } : null,
      vehicle: vehicle
        ? {
            plate: vehicle.plate,
            color: vehicle.color,
            model: `${vehicle.make} ${vehicle.model}`,
          }
        : null,
      position: trip.tracking[0] ?? null,
      completedAt: trip.completedAt,
      expiresAt: record.expiresAt,
    };
  }
}
