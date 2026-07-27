import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AlertService } from "../../common/observability/alert.service";
import { NotificationsService } from "../notifications/notifications.service";
import { decodePolyline, distanceToPathMeters } from "../geo/geo.util";
import type { GeoLatLng } from "../geo/providers/geo-provider.interface";

/**
 * كشف انحراف المسار (Route Deviation).
 *
 * بعد المرحلة 1 أصبح لكل رحلة `routePolyline` حقيقي من محرك التوجيه،
 * وفي `TripTracking` نقاط GPS لحظية — لكن **لم يكن أحد يقارن بينهما**.
 * أي أن السائق كان يمكنه الخروج عن الطريق بكيلومترات دون أي إنذار.
 *
 * المنطق هنا بسيط ومتحفّظ عمدًا لتفادي الإنذارات الكاذبة:
 *  1. تُحسب أقصر مسافة بين نقطة GPS والمسار المخطّط.
 *  2. لا يُطلق الإنذار إلا بعد تجاوز العتبة في **ثلاث نقاط متتالية** (تشويش GPS لحظي لا يكفي).
 *  3. إنذار واحد لكل رحلة (لا إزعاج متكرر).
 *
 * المنعطف الطبيعي لتجنّب ازدحام أو طريق مغلق أمر مشروع؛ لذلك النتيجة
 * **تنبيه للمراقبة وإشعار للراكب، وليس إيقاف الرحلة**.
 */

/** مسافة الانحراف التي تُعتبر خروجًا عن المسار (متر). */
export const DEVIATION_THRESHOLD_M = 600;
/** عدد النقاط المتتالية المطلوبة قبل إطلاق الإنذار. */
export const DEVIATION_STRIKES = 3;
/** الحالات التي يُفحص فيها الانحراف (أثناء وجود الراكب في السيارة فقط). */
export const DEVIATION_STATUSES = ["ONGOING"] as const;
/** مدّة حفظ المسار المفكوك في الذاكرة (ثوانٍ). */
export const ROUTE_CACHE_TTL_MS = 30 * 60_000;

interface TripRouteState {
  path: GeoLatLng[];
  strikes: number;
  alerted: boolean;
  loadedAt: number;
}

/** حكم نقي: هل تجاوزت النقطة عتبة الانحراف؟ */
export function isDeviating(
  point: GeoLatLng,
  path: GeoLatLng[],
  thresholdM: number = DEVIATION_THRESHOLD_M,
): boolean {
  const distance = distanceToPathMeters(point, path);
  if (!Number.isFinite(distance)) return false;
  return distance > thresholdM;
}

@Injectable()
export class RouteDeviationService {
  private readonly logger = new Logger("RouteDeviation");
  private readonly states = new Map<string, TripRouteState>();
  /** إيقاف فوري عبر البيئة دون إعادة نشر شفرة. */
  private readonly enabled = process.env.ROUTE_DEVIATION_ENABLED !== "false";
  private readonly thresholdM = Number(
    process.env.ROUTE_DEVIATION_THRESHOLD_M ?? DEVIATION_THRESHOLD_M,
  );

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly alerts?: AlertService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * يُستدعى مع كل نقطة تتبّع. أفضل-جهد بالكامل: لا يرمي أبدًا
   * ولا يؤخّر البثّ الحيّ.
   */
  async check(tripId: string, point: GeoLatLng): Promise<void> {
    if (!this.enabled) return;
    try {
      const state = await this.stateFor(tripId);
      if (!state || state.alerted || state.path.length < 2) return;

      if (!isDeviating(point, state.path, this.thresholdM)) {
        state.strikes = 0;
        return;
      }

      state.strikes += 1;
      if (state.strikes < DEVIATION_STRIKES) return;

      state.alerted = true;
      await this.raise(tripId, point);
    } catch (error) {
      this.logger.warn(
        `تعذر فحص انحراف المسار للرحلة ${tripId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** يُنظّف حالة الرحلة من الذاكرة عند انتهائها (يمنع تسرّب الذاكرة). */
  forget(tripId: string): void {
    this.states.delete(tripId);
  }

  private async stateFor(tripId: string): Promise<TripRouteState | null> {
    const cached = this.states.get(tripId);
    if (cached && Date.now() - cached.loadedAt < ROUTE_CACHE_TTL_MS) {
      return cached;
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { status: true, routePolyline: true },
    });
    if (!trip?.routePolyline) return null;
    if (
      !(DEVIATION_STATUSES as readonly string[]).includes(String(trip.status))
    ) {
      return null;
    }

    const state: TripRouteState = {
      path: decodePolyline(trip.routePolyline),
      strikes: cached?.strikes ?? 0,
      alerted: cached?.alerted ?? false,
      loadedAt: Date.now(),
    };
    this.states.set(tripId, state);
    return state;
  }

  /** يسجّل الحدث، يُنذر المراقبة، ويُعلم الراكب. */
  private async raise(tripId: string, point: GeoLatLng): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true, passengerId: true, driverId: true },
    });

    await this.prisma.tripEvent
      .create({
        data: {
          tripId,
          type: "ROUTE_DEVIATION",
          actor: "SYSTEM",
          meta: {
            lat: point.lat,
            lng: point.lng,
            thresholdM: this.thresholdM,
            strikes: DEVIATION_STRIKES,
          },
        },
      })
      .catch(() => undefined);

    await this.alerts
      ?.emit({
        kind: "trip.route_deviation",
        severity: "WARNING",
        title: "انحراف عن المسار",
        message: `الرحلة ${tripId} خرجت أكثر من ${this.thresholdM} متر عن المسار المخطّط في ${DEVIATION_STRIKES} نقاط متتالية.`,
        context: {
          tripId,
          driverId: trip?.driverId ?? null,
          lat: point.lat,
          lng: point.lng,
        },
      })
      .catch(() => undefined);

    if (trip?.passengerId && this.notifications) {
      await this.notifications
        .notifyUser(
          trip.passengerId,
          "تغيّر المسار",
          "يبدو أن السيارة ابتعدت عن المسار المتوقّع. إن لم تكن تعلم السبب، يمكنك مشاركة رحلتك أو طلب المساعدة.",
          "PUSH",
          { kind: "safety", reason: "route_deviation", tripId },
        )
        .catch(() => undefined);
    }

    this.logger.warn(`انحراف مسار مؤكّد للرحلة ${tripId}`);
  }
}
