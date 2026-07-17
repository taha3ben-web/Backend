import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { FinancialService } from "../financial/financial.service";
import {
  NormalizedWebhookEvent,
  PaymentActionResult,
  PaymentProviderService,
} from "./payment-provider.service";
import { BlacklistKind, RiskService } from "../risk/risk.service";
import { CreatePaymentCheckoutDto } from "./dto/payments.dto";
import { TracerService } from "../../common/observability/tracer.service";
import { AppException } from "../../common/api/app.exception";
import { canPaymentTransition } from "./payment-transitions";

const PAYMENT_VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAYMENT_VELOCITY_MAX_COUNT = 10;

type MutablePayment = Prisma.PaymentGetPayload<{
  include: {
    trip: true;
    user: { select: { name: true; phone: true } };
  };
}>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
    private readonly provider: PaymentProviderService,
    private readonly risk: RiskService,
    @Optional() private readonly tracer?: TracerService,
  ) {}

  private withTrace<T>(
    name: string,
    attributes: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.tracer
      ? this.tracer.withSpan(name, async () => fn(), attributes)
      : fn();
  }

  async findAll(
    q: PaginationDto,
    status?: PaymentStatus,
    method?: PaymentMethod,
    provider?: string,
    search?: string,
  ) {
    const where = this.buildWhere(status, method, provider, search);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
          trip: {
            select: { id: true, fare: true, status: true, currency: true },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async summary(
    status?: PaymentStatus,
    method?: PaymentMethod,
    provider?: string,
    search?: string,
  ) {
    const where = this.buildWhere(status, method, provider, search);
    const [
      totalCount,
      totalAmount,
      capturedAmount,
      pendingCount,
      failedCount,
      refundedCount,
    ] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
      this.prisma.payment.aggregate({
        where: {
          ...where,
          status: { in: ["CAPTURED", "PAID"] },
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.count({
        where: {
          ...where,
          status: { in: ["PENDING", "AUTHORIZED"] },
        },
      }),
      this.prisma.payment.count({
        where: {
          ...where,
          status: "FAILED",
        },
      }),
      this.prisma.payment.count({
        where: {
          ...where,
          status: "REFUNDED",
        },
      }),
    ]);

    return {
      totalCount,
      totalAmount: Number(totalAmount._sum.amount ?? 0),
      capturedAmount: Number(capturedAmount._sum.amount ?? 0),
      pendingCount,
      failedCount,
      refundedCount,
    };
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, phone: true } },
        trip: true,
        events: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!payment) {
      throw new AppException("PAYMENT_NOT_FOUND", { details: { paymentId: id } });
    }
    const [ledgerTransactions, riskEvents] = await Promise.all([
      this.prisma.ledgerTransaction.findMany({
        where: { referenceType: "PAYMENT", referenceId: id },
        orderBy: { createdAt: "desc" },
        include: {
          reversalOf: { select: { id: true, command: true, status: true } },
          reversedBy: { select: { id: true, command: true, status: true } },
          entries: {
            include: {
              account: { select: { code: true, currency: true } },
            },
          },
        },
      }),
      this.prisma.riskEvent.findMany({
        where: {
          subjectKind: "USER",
          subjectId: payment.userId,
          action: { startsWith: "payment." },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);
    return { ...payment, ledgerTransactions, riskEvents };
  }

  async findRefunds(q: PaginationDto, provider?: string, search?: string) {
    const where = this.buildWhere("REFUNDED", undefined, provider, search);
    const [payments, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { refundedAt: "desc" },
        include: {
          user: { select: { name: true, phone: true } },
          trip: { select: { id: true, status: true, currency: true } },
          events: {
            where: { type: { contains: "refund" } },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    const ids = payments.map((payment) => payment.id);
    const reversals = ids.length
      ? await this.prisma.ledgerTransaction.findMany({
          where: {
            referenceType: "PAYMENT",
            referenceId: { in: ids },
            command: "refundPayment",
          },
          orderBy: { createdAt: "desc" },
          include: {
            reversalOf: { select: { id: true, command: true, status: true } },
          },
        })
      : [];
    const reversalByPayment = new Map(
      reversals.map((reversal) => [reversal.referenceId, reversal]),
    );
    return {
      items: payments.map((payment) => ({
        ...payment,
        ledgerReversal: reversalByPayment.get(payment.id) ?? null,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async createCheckoutForTrip(tripId: string, dto: CreatePaymentCheckoutDto) {
    return this.withTrace(
      "payments.create_checkout",
      {
        tripId,
        requestedMethod: dto.method ?? null,
        requestedProvider: dto.provider ?? null,
      },
      async () => {
        const trip = await this.prisma.trip.findUnique({
          where: { id: tripId },
          select: {
            id: true,
            passengerId: true,
            fare: true,
            currency: true,
            paymentMethod: true,
          },
        });
        if (!trip)
          throw new AppException("TRIP_NOT_FOUND", { details: { tripId } });
        if (trip.fare == null) {
          throw new AppException("TRIP_FARE_UNAVAILABLE", {
            details: { tripId },
          });
        }

        const existing = await this.prisma.payment.findUnique({
          where: { tripId },
          include: {
            user: { select: { name: true, phone: true } },
            trip: { select: { id: true, fare: true, status: true } },
          },
        });
        if (
          existing &&
          existing.status !== "FAILED" &&
          existing.status !== "REFUNDED" &&
          existing.status !== "CANCELED"
        ) {
          return {
            payment: existing,
            checkout: {
              provider: existing.provider,
              providerPaymentId:
                existing.providerPaymentId ??
                `${existing.provider}:${existing.id}`,
              providerStatus: existing.providerStatus ?? "reused",
              checkoutUrl: null,
              payload: { reused: true },
            },
          };
        }

        const methodValue = dto.method ?? trip.paymentMethod;
        const amount = Number(trip.fare);

        await this.assessPaymentRisk(trip.passengerId, amount, methodValue);

        const bootstrapPaymentId = existing?.id ?? `${tripId}-bootstrap`;
        const checkout = await this.provider.createCheckout({
          paymentId: bootstrapPaymentId,
          tripId,
          method: methodValue,
          amount,
          currency: trip.currency,
          provider: dto.provider,
          returnUrl: dto.returnUrl,
          cancelUrl: dto.cancelUrl,
        });

        const created = await this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const payment = await tx.payment.upsert({
            where: { tripId },
            create: {
              tripId,
              userId: trip.passengerId,
              amount,
              method: methodValue,
              provider: checkout.provider,
              providerPaymentId: checkout.providerPaymentId,
              providerStatus: checkout.providerStatus,
              status: methodValue === "WALLET" ? "PAID" : "PENDING",
              reference: dto.reference,
              metadata: this.toJsonValue(checkout.payload),
              authorizedAt: methodValue === "WALLET" ? now : null,
              capturedAt: methodValue === "WALLET" ? now : null,
            },
            update: {
              amount,
              method: methodValue,
              provider: checkout.provider,
              providerPaymentId: checkout.providerPaymentId,
              providerStatus: checkout.providerStatus,
              reference: dto.reference ?? undefined,
              metadata: this.toJsonValue(checkout.payload),
              status: methodValue === "WALLET" ? "PAID" : "PENDING",
              statusReason: null,
              failedAt: null,
              canceledAt: null,
              refundedAt: null,
              authorizedAt: methodValue === "WALLET" ? now : null,
              capturedAt: methodValue === "WALLET" ? now : null,
            },
            include: {
              user: { select: { name: true, phone: true } },
              trip: { select: { id: true, fare: true, status: true } },
            },
          });

          await this.appendEvent(tx, payment.id, "checkout_initialized", {
            status: payment.status,
            provider: checkout.provider,
            reference: dto.reference,
            payload: checkout.payload,
            idempotencyKey: `payment:checkout:${payment.id}`,
          });

          return payment;
        });

        return { payment: created, checkout };
      },
    );
  }

  async recordForTrip(
    tripId: string,
    method: PaymentMethod,
    reference?: string,
  ) {
    const checkout = await this.createCheckoutForTrip(tripId, {
      method,
      reference,
    });
    return checkout.payment;
  }

  async capture(
    id: string,
    reference?: string,
    reason?: string,
    actorId?: string,
  ) {
    const payment = await this.findMutable(id);
    const target = payment.method === "CARD" ? "CAPTURED" : "PAID";
    this.assertTransition(payment.status, target);
    const operation = await this.provider.capture({
      paymentId: payment.id,
      provider: payment.provider,
      amount: Number(payment.amount),
      currency: payment.trip.currency,
    });
    return this.updateStatus(
      id,
      target,
      reference ?? operation.reference,
      reason ?? operation.statusReason,
      operation,
      actorId,
    );
  }

  async refund(
    id: string,
    reference?: string,
    reason?: string,
    actorId?: string,
  ) {
    const payment = await this.findMutable(id);
    this.assertTransition(payment.status, "REFUNDED");
    const operation = await this.provider.refund({
      paymentId: payment.id,
      provider: payment.provider,
      amount: Number(payment.amount),
      currency: payment.trip.currency,
    });
    return this.updateStatus(
      id,
      "REFUNDED",
      reference ?? operation.reference,
      reason ?? operation.statusReason,
      operation,
      actorId,
    );
  }

  async cancel(
    id: string,
    reference?: string,
    reason?: string,
    actorId?: string,
  ) {
    const payment = await this.findMutable(id);
    this.assertTransition(payment.status, "CANCELED");
    const operation = await this.provider.cancel({
      paymentId: payment.id,
      provider: payment.provider,
    });
    return this.updateStatus(
      id,
      "CANCELED",
      reference ?? operation.reference,
      reason ?? operation.statusReason,
      operation,
      actorId,
    );
  }

  async processWebhook(
    providerName: string,
    payload: Record<string, unknown>,
    eventId?: string,
  ) {
    return this.withTrace(
      "payments.process_webhook",
      { provider: providerName, eventId: eventId ?? null },
      async () => {
        const normalized = this.provider.normalizeWebhook(
          providerName,
          payload,
          eventId,
        );

        const duplicate = await this.prisma.paymentEvent.findUnique({
          where: { idempotencyKey: normalized.idempotencyKey },
        });
        if (duplicate) {
          return {
            accepted: true,
            duplicate: true,
            paymentId: duplicate.paymentId,
          };
        }

        const payment = await this.findPaymentForWebhook(
          this.prisma,
          normalized,
        );
        if (!payment) {
          return { accepted: false, reason: "payment_not_found" };
        }

        if (normalized.status && payment.status !== normalized.status) {
          this.assertTransition(payment.status, normalized.status);

          if (
            (normalized.status === "CAPTURED" ||
              normalized.status === "PAID") &&
            payment.method === "CARD"
          ) {
            await this.financial.captureCardPayment(payment.id);
          }

          if (
            normalized.status === "REFUNDED" &&
            payment.method === "CARD" &&
            (payment.status === "CAPTURED" || payment.status === "PAID")
          ) {
            await this.financial.refundPayment(payment.id);
          }
        }

        return this.prisma.$transaction(async (tx) => {
          const duplicateInTx = await tx.paymentEvent.findUnique({
            where: { idempotencyKey: normalized.idempotencyKey },
          });
          if (duplicateInTx) {
            return {
              accepted: true,
              duplicate: true,
              paymentId: duplicateInTx.paymentId,
            };
          }

          await this.appendEvent(
            tx,
            payment.id,
            `webhook:${normalized.eventType}`,
            {
              status: normalized.status,
              provider: normalized.provider,
              reference: normalized.reference,
              payload: normalized.payload,
              idempotencyKey: normalized.idempotencyKey,
            },
          );

          if (!normalized.status || payment.status === normalized.status) {
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                providerStatus: normalized.providerStatus,
                statusReason: normalized.reason ?? payment.statusReason,
              },
            });
            return {
              accepted: true,
              paymentId: payment.id,
              statusChanged: false,
            };
          }

          await tx.payment.update({
            where: { id: payment.id },
            data: this.buildStatusPatch(
              payment,
              normalized.status,
              normalized.reference,
              normalized.reason,
              {
                provider: normalized.provider,
                providerStatus:
                  normalized.providerStatus ?? normalized.eventType,
                reference: normalized.reference,
                statusReason: normalized.reason,
                payload: normalized.payload,
              },
            ),
          });

          return { accepted: true, paymentId: payment.id, statusChanged: true };
        });
      },
    );
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    reference?: string,
    reason?: string,
    operation?: PaymentActionResult,
    actorId?: string,
  ) {
    const payment = await this.findMutable(id);
    this.assertTransition(payment.status, status);

    if (
      (status === "CAPTURED" || status === "PAID") &&
      payment.method === "CARD"
    ) {
      await this.financial.captureCardPayment(payment.id);
    }

    if (
      status === "REFUNDED" &&
      payment.method === "CARD" &&
      (payment.status === "CAPTURED" || payment.status === "PAID")
    ) {
      await this.financial.refundPayment(payment.id);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id },
        data: this.buildStatusPatch(
          payment,
          status,
          reference,
          reason,
          operation,
        ),
        include: {
          user: { select: { name: true, phone: true } },
          trip: true,
          events: {
            orderBy: { createdAt: "desc" },
            take: 20,
          },
        },
      });

      await this.appendEvent(tx, updated.id, `status_${status.toLowerCase()}`, {
        status,
        provider: operation?.provider ?? updated.provider,
        reference,
        payload: operation?.payload,
      });

      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "PAYMENT_STATUS_CHANGED",
          entity: "Payment",
          entityId: updated.id,
          meta: {
            from: payment.status,
            to: status,
            provider: updated.provider,
            reference: reference ?? null,
            reason: reason ?? null,
          },
        },
      });

      return updated;
    });
  }

  private async assessPaymentRisk(
    userId: string,
    amount: number,
    method: PaymentMethod,
  ) {
    const now = Date.now();
    const windowStart = new Date(now - PAYMENT_VELOCITY_WINDOW_MS);
    const [recent, aggregate, chargebackCount] = await this.prisma.$transaction(
      [
        this.prisma.payment.findMany({
          where: {
            userId,
            createdAt: { gte: windowStart },
          },
          select: { createdAt: true, amount: true },
        }),
        this.prisma.payment.aggregate({
          where: { userId, status: { in: ["CAPTURED", "PAID"] } },
          _avg: { amount: true },
        }),
        this.prisma.payment.count({
          where: { userId, status: "REFUNDED" },
        }),
      ],
    );

    const history = recent.map((r) => ({
      at: r.createdAt.getTime(),
      amount: Number(r.amount),
    }));
    const avgAmount = Number(aggregate._avg.amount ?? 0) || undefined;

    const blacklistChecks: Array<{ kind: BlacklistKind; value: string }> = [
      { kind: "USER", value: userId },
    ];

    const assessment = await this.risk.assess({
      subjectKind: "USER",
      subjectId: userId,
      action: `payment.checkout.${method.toLowerCase()}`,
      amount,
      avgAmount,
      chargebackCount,
      blacklistChecks,
      velocity: {
        history,
        limit: {
          windowMs: PAYMENT_VELOCITY_WINDOW_MS,
          maxCount: PAYMENT_VELOCITY_MAX_COUNT,
        },
        now,
      },
    });

    if (RiskService.shouldBlock(assessment.decision)) {
      throw new AppException("RISK_BLOCKED", {
        details: { action: `payment.checkout.${method.toLowerCase()}` },
      });
    }
  }

  private buildStatusPatch(
    payment: MutablePayment,
    status: PaymentStatus,
    reference?: string,
    reason?: string,
    operation?: PaymentActionResult,
  ): Prisma.PaymentUpdateInput {
    const now = new Date();
    const data: Prisma.PaymentUpdateInput = {
      status,
      reference: reference ?? payment.reference,
      providerStatus: operation?.providerStatus ?? payment.providerStatus,
      statusReason: reason ?? null,
    };

    if (status === "AUTHORIZED") {
      data.authorizedAt = payment.authorizedAt ?? now;
    }
    if (status === "CAPTURED" || status === "PAID") {
      data.authorizedAt = payment.authorizedAt ?? now;
      data.capturedAt = payment.capturedAt ?? now;
      data.failedAt = null;
      data.canceledAt = null;
    }
    if (status === "FAILED") {
      data.failedAt = now;
    }
    if (status === "REFUNDED") {
      data.refundedAt = now;
    }
    if (status === "CANCELED") {
      data.canceledAt = now;
    }

    return data;
  }

  private assertTransition(current: PaymentStatus, next: PaymentStatus) {
    if (current === next || !canPaymentTransition(current, next)) {
      throw new AppException("INVALID_PAYMENT_TRANSITION", {
        details: { current, next },
      });
    }
  }

  private async findMutable(id: string): Promise<MutablePayment> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        trip: true,
        user: { select: { name: true, phone: true } },
      },
    });
    if (!payment) {
      throw new AppException("PAYMENT_NOT_FOUND", { details: { paymentId: id } });
    }
    return payment;
  }

  private async findPaymentForWebhook(
    client: Prisma.TransactionClient | PrismaService,
    event: NormalizedWebhookEvent,
  ) {
    if (event.internalPaymentId) {
      const byId = await client.payment.findUnique({
        where: { id: event.internalPaymentId },
        include: { trip: true, user: { select: { name: true, phone: true } } },
      });
      if (byId) return byId;
    }
    if (event.providerPaymentId) {
      const byProviderPaymentId = await client.payment.findFirst({
        where: {
          provider: event.provider,
          providerPaymentId: event.providerPaymentId,
        },
        include: { trip: true, user: { select: { name: true, phone: true } } },
      });
      if (byProviderPaymentId) return byProviderPaymentId;
    }
    if (event.reference) {
      return client.payment.findFirst({
        where: { reference: event.reference },
        include: { trip: true, user: { select: { name: true, phone: true } } },
      });
    }
    return null;
  }

  private async appendEvent(
    tx: Prisma.TransactionClient,
    paymentId: string,
    type: string,
    input: {
      status?: string;
      provider?: string;
      idempotencyKey?: string;
      reference?: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (input.idempotencyKey) {
      const existing = await tx.paymentEvent.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return;
    }
    await tx.paymentEvent.create({
      data: {
        paymentId,
        type,
        status: input.status,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        reference: input.reference,
        payload: this.toJsonValue(input.payload),
      },
    });
  }

  private toJsonValue(
    value?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private buildWhere(
    status?: PaymentStatus,
    method?: PaymentMethod,
    provider?: string,
    search?: string,
  ): Prisma.PaymentWhereInput {
    return {
      ...(status ? { status } : {}),
      ...(method ? { method } : {}),
      ...(provider
        ? { provider: { equals: provider, mode: "insensitive" } }
        : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: "insensitive" } },
              { providerPaymentId: { contains: search, mode: "insensitive" } },
              { providerStatus: { contains: search, mode: "insensitive" } },
              { user: { name: { contains: search, mode: "insensitive" } } },
              { user: { phone: { contains: search, mode: "insensitive" } } },
              { trip: { id: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
  }
}
