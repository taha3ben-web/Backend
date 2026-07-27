import {
  Controller,
  Get,
  Header,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MetricsService } from "./metrics.service";

type Check = { ok: boolean; latencyMs?: number; error?: string };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * نقاط رصد التشغيل (observability):
 *  - GET /api/metrics             → JSON (uptime, memory, WS, DB, Redis, drivers)
 *  - GET /api/metrics/prometheus  → صيغة Prometheus للماسحات
 *
 * الحماية: إن ضُبِط METRICS_TOKEN يُطلب تمريره عبر Authorization: Bearer <token>.
 * إن لم يُضبط (تطوير) تبقى النقطة مفتوحة.
 */
import { Public } from "../../common/decorators/public.decorator";

// مسارات عامة مقصودة (الحارس العالمي يحمي كل ما عداها).
@Public()
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async json(@Headers("authorization") auth?: string) {
    this.assertAuthorized(auth);
    const [db, redis, driversWithGeo] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.countGeoDrivers(),
    ]);
    const mem = process.memoryUsage();
    return {
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rssMB: round2(mem.rss / 1048576),
        heapUsedMB: round2(mem.heapUsed / 1048576),
        heapTotalMB: round2(mem.heapTotal / 1048576),
      },
      websocket: {
        ...this.metrics.wsSnapshot(),
        ...this.metrics.counters(),
      },
      db,
      redis,
      driversWithGeo,
    };
  }

  @Get("prometheus")
  @Header("Content-Type", "text/plain; version=0.0.4")
  async prometheus(@Headers("authorization") auth?: string): Promise<string> {
    this.assertAuthorized(auth);
    const [db, redis, drivers] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
      this.countGeoDrivers(),
    ]);
    const ws = this.metrics.wsSnapshot();
    const c = this.metrics.counters();
    const mem = process.memoryUsage();
    const lines = [
      "# HELP nova_uptime_seconds Process uptime in seconds",
      "# TYPE nova_uptime_seconds gauge",
      `nova_uptime_seconds ${Math.round(process.uptime())}`,
      "# HELP nova_ws_connections Active websocket connections",
      "# TYPE nova_ws_connections gauge",
      `nova_ws_connections ${ws.total}`,
      `nova_ws_connections_by_role{role="passenger"} ${ws.byRole.PASSENGER}`,
      `nova_ws_connections_by_role{role="driver"} ${ws.byRole.DRIVER}`,
      `nova_ws_connections_by_role{role="staff"} ${ws.byRole.STAFF}`,
      "# HELP nova_ws_connected_total Cumulative websocket connections",
      "# TYPE nova_ws_connected_total counter",
      `nova_ws_connected_total ${c.wsConnectedTotal}`,
      "# HELP nova_ws_disconnected_total Cumulative websocket disconnections",
      "# TYPE nova_ws_disconnected_total counter",
      `nova_ws_disconnected_total ${c.wsDisconnectedTotal}`,
      "# HELP nova_db_up Database reachability (1=up)",
      "# TYPE nova_db_up gauge",
      `nova_db_up ${db.ok ? 1 : 0}`,
      "# HELP nova_db_latency_ms Database round-trip latency",
      "# TYPE nova_db_latency_ms gauge",
      `nova_db_latency_ms ${db.latencyMs ?? -1}`,
      "# HELP nova_redis_up Redis reachability (1=up)",
      "# TYPE nova_redis_up gauge",
      `nova_redis_up ${redis.ok ? 1 : 0}`,
      "# HELP nova_redis_latency_ms Redis round-trip latency",
      "# TYPE nova_redis_latency_ms gauge",
      `nova_redis_latency_ms ${redis.latencyMs ?? -1}`,
      "# HELP nova_drivers_with_geo Drivers currently tracked in the geo index",
      "# TYPE nova_drivers_with_geo gauge",
      `nova_drivers_with_geo ${drivers}`,
      "# HELP nova_memory_rss_bytes Resident set size in bytes",
      "# TYPE nova_memory_rss_bytes gauge",
      `nova_memory_rss_bytes ${mem.rss}`,
    ];
    return lines.join("\n") + "\n";
  }

  private assertAuthorized(auth?: string): void {
    const token = process.env.METRICS_TOKEN;
    if (!token) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException(
          "metrics protection is not configured",
        );
      }
      return; // غير مقيّد في التطوير فقط
    }
    const provided = auth && auth.startsWith("Bearer ") ? auth.slice(7) : auth;
    if (provided !== token) {
      throw new UnauthorizedException("metrics token غير صالح");
    }
  }

  private async checkDb(): Promise<Check> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<Check> {
    const start = Date.now();
    try {
      const pong = await this.redis.client.ping();
      return { ok: pong === "PONG", latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async countGeoDrivers(): Promise<number> {
    try {
      return await this.redis.client.zcard("drivers:geo");
    } catch {
      return -1;
    }
  }
}
