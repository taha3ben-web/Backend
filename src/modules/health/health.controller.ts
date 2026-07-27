import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

type CheckResult = { ok: boolean; latencyMs?: number; error?: string };

/**
 * فحوص الصحة لـ Cloud Run / Kubernetes / Load Balancer:
 *  - GET /api/health       → liveness بسيط (العملية حيّة)
 *  - GET /api/health/live  → liveness صريح
 *  - GET /api/health/ready → readiness يفحص PostgreSQL و Redis فعليًا (503 عند الفشل)
 */
import { Public } from "../../common/decorators/public.decorator";

// مسارات عامة مقصودة (الحارس العالمي يحمي كل ما عداها).
@Public()
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  live() {
    return {
      ok: true,
      service: "nova-backend",
      status: "live",
      uptimeSec: Math.round(process.uptime()),
      ts: new Date().toISOString(),
    };
  }

  @Get("live")
  liveness() {
    return this.live();
  }

  @Get("ready")
  async ready() {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const ok = db.ok && redis.ok;
    const body = {
      ok,
      status: ok ? "ready" : "degraded",
      checks: { db, redis },
      ts: new Date().toISOString(),
    };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }

  private async checkDb(): Promise<CheckResult> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const pong = await this.redis.client.ping();
      return { ok: pong === "PONG", latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
