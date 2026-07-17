import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  isPoolCompatible,
  normalizePoolConfig,
  type PoolConfig,
  type PoolLeg,
} from "./pooling.util";

const MAX_POOL_CANDIDATES = 10;
const SCAN_LIMIT = 50;

export interface PoolCandidate {
  tripId: string;
  passengerId: string;
  pickupDistanceKm: number;
  detourKm: number;
  bearingDiff: number;
}

export interface PoolMatchResult {
  enabled: boolean;
  tripId: string;
  config: PoolConfig;
  candidates: PoolCandidate[];
}

/**
 * خدمة أساس المشاركة في الرحلة (Ride Pooling foundation): ترشّح رحلات
 * أخرى تبحث عن سائق (SEARCHING) وتتوافق اتجاهًا وقربًا مع رحلة معينة.
 *
 * - لا تُعدّل تدفق الرحلة ولا تُسند سائقًا — قراءة وترشيح فقط (أساس لمراحل لاحقة).
 * - لا يحتوي أي تسعير أو خصم — كل الخصومات تُدار من لوحة التحكم.
 * - معطّلة افتراضيًا (RIDE_POOLING_ENABLED=true للتفعيل) حفاظًا على التوافق الخلفي.
 * - fail-open: أي خطأ يُرجع قائمة فارغة فلا تتعطل أي عملية.
 */
@Injectable()
export class PoolingService {
  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return process.env.RIDE_POOLING_ENABLED === "true";
  }

  configFromEnv(): PoolConfig {
    return normalizePoolConfig({
      maxPickupDistanceKm: numEnv("POOL_MAX_PICKUP_KM"),
      maxDetourKm: numEnv("POOL_MAX_DETOUR_KM"),
      directionToleranceDeg: numEnv("POOL_DIRECTION_TOLERANCE_DEG"),
    });
  }

  /**
   * يرشّح رفاق رحلة محتملين لرحلة معينة (مرتّبين حسب أقل انحراف).
   * يرجع قائمة فارغة إن كان معطّلًا أو الرحلة غير صالحة أو عند أي خطأ.
   */
  async findCandidates(tripId: string): Promise<PoolMatchResult> {
    const config = this.configFromEnv();
    const enabled = this.isEnabled();
    const empty: PoolMatchResult = { enabled, tripId, config, candidates: [] };
    if (!enabled || !tripId) return empty;
    try {
      const trip = await this.prisma.trip.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          cityId: true,
          rideClass: true,
          pickupLat: true,
          pickupLng: true,
          destLat: true,
          destLng: true,
        },
      });
      if (
        !trip ||
        trip.destLat == null ||
        trip.destLng == null ||
        trip.cityId == null
      ) {
        return empty;
      }
      const base: PoolLeg = {
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        destLat: trip.destLat,
        destLng: trip.destLng,
      };
      const others = await this.prisma.trip.findMany({
        where: {
          id: { not: tripId },
          status: "SEARCHING",
          driverId: null,
          cityId: trip.cityId,
          rideClass: trip.rideClass,
          destLat: { not: null },
          destLng: { not: null },
        },
        select: {
          id: true,
          passengerId: true,
          pickupLat: true,
          pickupLng: true,
          destLat: true,
          destLng: true,
        },
        orderBy: { createdAt: "asc" },
        take: SCAN_LIMIT,
      });
      const candidates: PoolCandidate[] = [];
      for (const o of others) {
        if (o.destLat == null || o.destLng == null) continue;
        const compat = isPoolCompatible(
          base,
          {
            pickupLat: o.pickupLat,
            pickupLng: o.pickupLng,
            destLat: o.destLat,
            destLng: o.destLng,
          },
          config,
        );
        if (!compat.compatible) continue;
        candidates.push({
          tripId: o.id,
          passengerId: o.passengerId,
          pickupDistanceKm: compat.pickupDistanceKm,
          detourKm: compat.detourKm,
          bearingDiff: compat.bearingDiff,
        });
      }
      candidates.sort((a, b) => a.detourKm - b.detourKm);
      return {
        enabled,
        tripId,
        config,
        candidates: candidates.slice(0, MAX_POOL_CANDIDATES),
      };
    } catch {
      return empty;
    }
  }
}

function numEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
