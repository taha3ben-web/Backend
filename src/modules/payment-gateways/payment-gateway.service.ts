import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  classifyWebhookHealth,
  countWebhookProviders,
  GatewayProvider,
  isProtectionConfigured,
  resolveGatewayProviders,
  WebhookHealth,
} from "./payment-gateway.util";

type ProviderGroupRow = { provider: string | null; _count: { _all: number } };
type TypeGroupRow = { type: string; _count: { _all: number } };

export interface WebhookHealthReport extends WebhookHealth {
  windowHours: number;
  lastEventAt: string | null;
  byProvider: Array<{ provider: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  generatedAt: string;
}

export interface RecentWebhookEvent {
  id: string;
  type: string;
  status: string | null;
  provider: string | null;
  reference: string | null;
  paymentId: string;
  createdAt: string;
}

/**
 * خدمة سجلّ مزوّدي الدفع (PSP) ورصد صحّة الـ webhooks:
 * طبقة رؤية فوق البنية القائمة (Payment/PaymentEvent) دون لمس تدفّق
 * الدفع أو التوقيع الحرج. تقرأ إعداد المزوّدين من البيئة (دون كشف
 * الأسرار) وتجمّع أحداث الدفع لاشتقاق الصحّة. لا منطق تسعير/خصم.
 */
@Injectable()
export class PaymentGatewayService {
  constructor(private readonly prisma: PrismaService) {}

  /** سجلّ المزوّدين المُعدّين حاليًا (من البيئة) مع قدراتهم وحالة حمايتهم. */
  listProviders(): GatewayProvider[] {
    return resolveGatewayProviders(process.env);
  }

  /** رصد صحّة مسار الـ webhooks خلال نافذة زمنية. */
  async webhookHealth(windowHours = 24): Promise<WebhookHealthReport> {
    const providers = this.listProviders();
    const now = new Date();
    const since = new Date(now.getTime() - windowHours * 60 * 60 * 1_000);

    const [total, failed, latest, byProviderRaw, byTypeRaw] = await Promise.all([
      this.prisma.paymentEvent.count({ where: { createdAt: { gte: since } } }),
      this.prisma.paymentEvent.count({
        where: { createdAt: { gte: since }, status: "FAILED" },
      }),
      this.prisma.paymentEvent.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.paymentEvent.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }) as unknown as Promise<ProviderGroupRow[]>,
      this.prisma.paymentEvent.groupBy({
        by: ["type"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }) as unknown as Promise<TypeGroupRow[]>,
    ]);

    const lastEventAgeMs = latest
      ? Math.max(0, now.getTime() - latest.createdAt.getTime())
      : null;

    const health = classifyWebhookHealth({
      totalEvents: total,
      failedEvents: failed,
      lastEventAgeMs,
      webhookProviders: countWebhookProviders(providers),
      protectionConfigured: isProtectionConfigured(providers),
    });

    const byProvider = byProviderRaw
      .map((row) => ({ provider: row.provider ?? "unknown", count: row._count._all }))
      .sort((a, b) => b.count - a.count);
    const byType = byTypeRaw
      .map((row) => ({ type: row.type, count: row._count._all }))
      .sort((a, b) => b.count - a.count);

    return {
      ...health,
      windowHours,
      lastEventAt: latest ? latest.createdAt.toISOString() : null,
      byProvider,
      byType,
      generatedAt: now.toISOString(),
    };
  }

  /** أحدث أحداث الدفع (دون حمولة الـ payload الخام تجنّبًا لتسريب بيانات حسّاسة). */
  async recentEvents(limit = 30): Promise<RecentWebhookEvent[]> {
    const rows = await this.prisma.paymentEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        provider: true,
        reference: true,
        paymentId: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      provider: row.provider,
      reference: row.reference,
      paymentId: row.paymentId,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
