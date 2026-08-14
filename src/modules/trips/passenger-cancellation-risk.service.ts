import { Injectable, Logger } from "@nestjs/common";
import type { TripStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationDispatcher } from "../notifications/notification-dispatcher.service";
import {
  CancellationPolicyService,
  type PassengerCancellationRiskPolicy,
} from "./cancellation-policy.service";

/**
 * D-4 — سياسة إلغاء الراكب بلا أي غرامة مالية.
 *
 * القرار النهائي المعتمد:
 *   - لا خصم من محفطة الراكب ولا رصيد سالب بسبب الإلغاء (منفّذ في
 *     FinancialService.settlePassengerCancellationFee التي أصبحت بلا أثر مالي).
 *   - الإلغاء قبل قبول السائق يُسجّل للمراقبة فقط ولا يدخل في عدّ التجميد.
 *   - الإلغاء بعد القبول يُسجّل في RiskEvent مع حالة الرحلة وقت الإلغاء.
 *   - الافتراضي: 3 إلغاءات مؤهلة خلال 30 يومًا → تجميد تلقائي، والقيمتان
 *     مضبوطتان من لوحة التحكم (trips.passengerCancellationRisk) لا من الكود.
 *   - قبل بلوغ الحد يُرسل تحدير واضح، فلا يكون التجميد مفاجئًا.
 *   - فك التجميد من لوحة التحكم فقط (UsersController + passengers.manage).
 *
 * لا يوجد نطام عقوبات ثانٍ: نعيد استخدام بنية المخاطر القائمة (RiskEvent /
 * RiskHold) وحالة المستخدم القائمة (User.status = SUSPENDED) و AuditLog القائم.
 */

export const RISK_SUBJECT_KIND = "USER";
export const RISK_ACTION_AFTER_ACCEPT = "TRIP_CANCEL_PASSENGER";
export const RISK_ACTION_BEFORE_ACCEPT = "TRIP_CANCEL_PASSENGER_SEARCHING";

export type CancelPreview = {
  /** مستوى خطورة القرار كما حسبه الخادم. */
  level: "NONE" | "INFO" | "WARN" | "CRITICAL";
  title: string;
  message: string;
  /** دائمًا false — لا توجد أي غرامة مالية على الراكب. */
  chargesMoney: false;
  /** هل يُحسب هذا الإلغاء ضمن عدّ التجميد؟ */
  counts: boolean;
  /** عدد الإلغاءات المؤهلة داخل النافذة قبل هذا الإلغاء. */
  cancellationsInWindow: number;
  /** عدد الإلغاءات المتبقية قبل التجميد (null = التجميد معطّل). */
  remainingBeforeFreeze: number | null;
  windowDays: number;
  affectsDriver: boolean;
};

@Injectable()
export class PassengerCancellationRiskService {
  private readonly logger = new Logger(PassengerCancellationRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: CancellationPolicyService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  private windowStart(policy: PassengerCancellationRiskPolicy): Date {
    return new Date(Date.now() - policy.windowDays * 24 * 60 * 60 * 1000);
  }

  /** عدد الإلغاءات المؤهلة (بعد القبول) داخل النافذة. */
  private async countQualifying(
    passengerId: string,
    policy: PassengerCancellationRiskPolicy,
  ): Promise<number> {
    return this.prisma.riskEvent.count({
      where: {
        subjectKind: RISK_SUBJECT_KIND,
        subjectId: passengerId,
        action: RISK_ACTION_AFTER_ACCEPT,
        createdAt: { gte: this.windowStart(policy) },
      },
    });
  }

  /**
   * معاينة قرار الخادم قبل تأكيد الإلغاء (D-7).
   * النص يأتي من الخادم وليس مكتوبًا داخل التطبيق، ولا يذكر أي خصم مالي.
   */
  async preview(
    passengerId: string,
    tripStatus: TripStatus,
    hasDriver: boolean,
  ): Promise<CancelPreview> {
    const policy = await this.policy.passengerCancellationRisk();
    const afterAccept = tripStatus !== "SEARCHING";
    const counts = policy.enabled && (afterAccept || !policy.countOnlyAfterAccept);
    const current = policy.enabled
      ? await this.countQualifying(passengerId, policy).catch(() => 0)
      : 0;
    const after = counts ? current + 1 : current;
    const freezeOn = policy.enabled && policy.freezeThreshold > 0;
    const remaining = freezeOn
      ? Math.max(0, policy.freezeThreshold - after)
      : null;

    if (!counts) {
      return {
        level: hasDriver ? "INFO" : "NONE",
        title: "\u062a\u0623\u0643\u064a\u062f \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0631\u062d\u0644\u0629",
        message:
          "\u0644\u0627 \u064a\u0648\u062c\u062f \u0623\u064a \u062e\u0635\u0645 \u0645\u0627\u0644\u064a \u0639\u0644\u064a\u0643\u060c \u0648\u0647\u0630\u0627 \u0627\u0644\u0625\u0644\u063a\u0627\u0621 \u0644\u0627 \u064a\u064f\u062d\u0633\u0628 \u0636\u0645\u0646 \u0633\u062c\u0644 \u0627\u0644\u0625\u0644\u063a\u0627\u0621\u0627\u062a \u0627\u0644\u0645\u062a\u0643\u0631\u0631\u0629 \u0644\u0623\u0646 \u0627\u0644\u0628\u062d\u062b \u0639\u0646 \u0633\u0627\u0626\u0642 \u0644\u0645 \u064a\u0646\u062a\u0647\u0650 \u0628\u0639\u062f.",
        chargesMoney: false,
        counts: false,
        cancellationsInWindow: current,
        remainingBeforeFreeze: remaining,
        windowDays: policy.windowDays,
        affectsDriver: hasDriver,
      };
    }

    if (freezeOn && after >= policy.freezeThreshold) {
      return {
        level: "CRITICAL",
        title: "\u062a\u062d\u0630\u064a\u0631: \u0642\u062f \u064a\u064f\u062c\u0645\u0651\u062f \u062d\u0633\u0627\u0628\u0643",
        message:
          `\u0644\u0627 \u064a\u0648\u062c\u062f \u0623\u064a \u062e\u0635\u0645 \u0645\u0627\u0644\u064a\u060c \u0644\u0643\u0646 \u0627\u0644\u0633\u0627\u0626\u0642 \u0642\u0628\u0644 \u0631\u062d\u0644\u062a\u0643 \u0648\u0647\u0648 \u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642 \u0625\u0644\u064a\u0643. ` +
          `\u0628\u0644\u063a\u062a \u0627\u0644\u062d\u062f \u0627\u0644\u0645\u0633\u0645\u0648\u062d \u0644\u0644\u0625\u0644\u063a\u0627\u0621\u0627\u062a (${policy.freezeThreshold} \u062e\u0644\u0627\u0644 ${policy.windowDays} \u064a\u0648\u0645\u064b\u0627)\u060c ` +
          `\u0648\u0625\u062a\u0645\u0627\u0645 \u0647\u0630\u0627 \u0627\u0644\u0625\u0644\u063a\u0627\u0621 \u0642\u062f \u064a\u0624\u062f\u064a \u0625\u0644\u0649 \u062a\u062c\u0645\u064a\u062f \u062d\u0633\u0627\u0628\u0643 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627\u060c \u0641\u0644\u0627 \u062a\u0633\u062a\u0637\u064a\u0639 \u0637\u0644\u0628 \u0631\u062d\u0644\u0627\u062a \u062c\u062f\u064a\u062f\u0629 \u062d\u062a\u0649 \u062a\u0631\u0627\u062c\u0639\u0647 \u0627\u0644\u0625\u062f\u0627\u0631\u0629.`,
        chargesMoney: false,
        counts: true,
        cancellationsInWindow: current,
        remainingBeforeFreeze: remaining,
        windowDays: policy.windowDays,
        affectsDriver: hasDriver,
      };
    }

    if (policy.warnThreshold > 0 && after >= policy.warnThreshold) {
      return {
        level: "WARN",
        title: "\u0625\u0644\u063a\u0627\u0621\u0627\u062a \u0645\u062a\u0643\u0631\u0631\u0629",
        message:
          `\u0644\u0627 \u064a\u0648\u062c\u062f \u0623\u064a \u062e\u0635\u0645 \u0645\u0627\u0644\u064a\u060c \u0644\u0643\u0646 \u0627\u0644\u0633\u0627\u0626\u0642 \u0642\u0628\u0644 \u0631\u062d\u0644\u062a\u0643 \u0648\u0647\u0648 \u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642 \u0625\u0644\u064a\u0643. ` +
          (remaining !== null
            ? `\u0643\u062b\u0631\u0629 \u0627\u0644\u0625\u0644\u063a\u0627\u0621\u0627\u062a \u0642\u062f \u062a\u0624\u062f\u064a \u0625\u0644\u0649 \u062a\u062c\u0645\u064a\u062f \u0627\u0644\u062d\u0633\u0627\u0628\u061b \u064a\u062a\u0628\u0642\u0651\u0649 \u0644\u062f\u064a\u0643 ${remaining} \u0642\u0628\u0644 \u0627\u0644\u062d\u062f \u062e\u0644\u0627\u0644 ${policy.windowDays} \u064a\u0648\u0645\u064b\u0627.`
            : `\u0643\u062b\u0631\u0629 \u0627\u0644\u0625\u0644\u063a\u0627\u0621\u0627\u062a \u062a\u064f\u0633\u062c\u0651\u0644 \u0639\u0644\u0649 \u062d\u0633\u0627\u0628\u0643 \u0648\u062a\u064f\u0631\u0627\u062c\u0639 \u0645\u0646 \u0627\u0644\u0625\u062f\u0627\u0631\u0629.`),
        chargesMoney: false,
        counts: true,
        cancellationsInWindow: current,
        remainingBeforeFreeze: remaining,
        windowDays: policy.windowDays,
        affectsDriver: hasDriver,
      };
    }

    return {
      level: "INFO",
      title: "\u062a\u0623\u0643\u064a\u062f \u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0631\u062d\u0644\u0629",
      message:
        "\u0644\u0627 \u064a\u0648\u062c\u062f \u0623\u064a \u062e\u0635\u0645 \u0645\u0627\u0644\u064a \u0639\u0644\u064a\u0643\u060c \u0644\u0643\u0646 \u0627\u0644\u0633\u0627\u0626\u0642 \u0642\u0628\u0644 \u0631\u062d\u0644\u062a\u0643 \u0648\u0642\u062f \u064a\u0643\u0648\u0646 \u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642 \u0625\u0644\u064a\u0643\u060c \u0648\u0627\u0644\u0625\u0644\u063a\u0627\u0621\u0627\u062a \u0627\u0644\u0645\u062a\u0643\u0631\u0631\u0629 \u062a\u064f\u0633\u062c\u0651\u0644 \u0639\u0644\u0649 \u062d\u0633\u0627\u0628\u0643.",
      chargesMoney: false,
      counts: true,
      cancellationsInWindow: current,
      remainingBeforeFreeze: remaining,
      windowDays: policy.windowDays,
      affectsDriver: hasDriver,
    };
  }

  /**
   * تسجيل إلغاء راكب ثم التحدير أو التجميد عند الحاجة.
 * أثر جانبي غير حرج: فشله لا يجوز أن يمنع الإلغاء نفسه.
   */
  async record(input: {
    passengerId: string;
    tripId: string;
    statusAtCancel: TripStatus;
    driverId?: string | null;
    reason?: string | null;
  }): Promise<void> {
    try {
      const policy = await this.policy.passengerCancellationRisk();
      if (!policy.enabled) return;
      const afterAccept = input.statusAtCancel !== "SEARCHING";
      const qualifies = afterAccept || !policy.countOnlyAfterAccept;
      const action = qualifies
        ? RISK_ACTION_AFTER_ACCEPT
        : RISK_ACTION_BEFORE_ACCEPT;

      await this.prisma.riskEvent.create({
        data: {
          subjectKind: RISK_SUBJECT_KIND,
          subjectId: input.passengerId,
          action,
          score: qualifies ? 10 : 0,
          level: "LOW",
          decision: "ALLOW",
          reasons: {
            tripId: input.tripId,
            statusAtCancel: input.statusAtCancel,
            driverAssigned: Boolean(input.driverId),
            driverId: input.driverId ?? null,
            cancelledAt: new Date().toISOString(),
            reason: input.reason ?? null,
            countsTowardFreeze: qualifies,
            policy: {
              windowDays: policy.windowDays,
              warnThreshold: policy.warnThreshold,
              freezeThreshold: policy.freezeThreshold,
            },
          },
        },
      });

      if (!qualifies) return;

      const total = await this.countQualifying(input.passengerId, policy);
      if (policy.freezeThreshold > 0 && total >= policy.freezeThreshold) {
        await this.freeze(input.passengerId, {
          tripId: input.tripId,
          total,
          policy,
        });
        return;
      }
      if (policy.warnThreshold > 0 && total >= policy.warnThreshold) {
        await this.warn(input.passengerId, { total, policy });
      }
    } catch (error) {
      this.logger.warn(
        `Passenger cancellation risk recording failed for trip ${input.tripId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** تحدير الراكب قبل الوصول للتجميد — لا يذكر أي مبلغ مالي. */
  private async warn(
    passengerId: string,
    ctx: { total: number; policy: PassengerCancellationRiskPolicy },
  ): Promise<void> {
    const remaining =
      ctx.policy.freezeThreshold > 0
        ? Math.max(0, ctx.policy.freezeThreshold - ctx.total)
        : null;
    await this.notifications
      .dispatch({
        channel: "PUSH",
        userIds: [passengerId],
        title: "\u0625\u0644\u063a\u0627\u0621\u0627\u062a \u0645\u062a\u0643\u0631\u0631\u0629",
        body:
          remaining !== null
            ? `\u0633\u062c\u0651\u0644\u0646\u0627 ${ctx.total} \u0625\u0644\u063a\u0627\u0621\u0627\u062a \u062e\u0644\u0627\u0644 ${ctx.policy.windowDays} \u064a\u0648\u0645\u064b\u0627. \u0645\u062a\u0628\u0642\u0651\u064d ${remaining} \u0642\u0628\u0644 \u062a\u062c\u0645\u064a\u062f \u0627\u0644\u062d\u0633\u0627\u0628 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627. \u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u064a \u063a\u0631\u0627\u0645\u0629 \u0645\u0627\u0644\u064a\u0629.`
            : `\u0633\u062c\u0651\u0644\u0646\u0627 ${ctx.total} \u0625\u0644\u063a\u0627\u0621\u0627\u062a \u062e\u0644\u0627\u0644 ${ctx.policy.windowDays} \u064a\u0648\u0645\u064b\u0627. \u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u064a \u063a\u0631\u0627\u0645\u0629 \u0645\u0627\u0644\u064a\u0629\u060c \u0644\u0643\u0646 \u0627\u0644\u062a\u0643\u0631\u0627\u0631 \u064a\u064f\u0631\u0627\u062c\u0639 \u0645\u0646 \u0627\u0644\u0625\u062f\u0627\u0631\u0629.`,
        data: { type: "cancellation_warning", count: String(ctx.total) },
      })
      .catch(() => undefined);
  }

  /**
   * تجميد تلقائي: User.status = SUSPENDED + RiskHold نشط + AuditLog.
   * حماية من التنفيذ المزدوج: updateMany مقيّدة بـ status: "ACTIVE"، فلو جرى
   * التجميد مرة لا تُكتب سجلات تدقيق مكررة.
   */
  private async freeze(
    passengerId: string,
    ctx: {
      tripId: string;
      total: number;
      policy: PassengerCancellationRiskPolicy;
    },
  ): Promise<void> {
    const reason = `\u0625\u0644\u063a\u0627\u0621\u0627\u062a \u0645\u062a\u0643\u0631\u0631\u0629: ${ctx.total} \u062e\u0644\u0627\u0644 ${ctx.policy.windowDays} \u064a\u0648\u0645\u064b\u0627 (\u0627\u0644\u062d\u062f ${ctx.policy.freezeThreshold})`;
    const changed = await this.prisma.user.updateMany({
      where: { id: passengerId, status: "ACTIVE" },
      data: { status: "SUSPENDED" },
    });
    if (changed.count === 0) return; // مجمّد/محظور أصلًا — idempotent.

    await this.prisma.riskHold
      .create({
        data: {
          subjectKind: RISK_SUBJECT_KIND,
          subjectId: passengerId,
          reason,
          active: true,
          createdBy: "SYSTEM",
        },
      })
      .catch(() => undefined);

    await this.prisma.auditLog
      .create({
        data: {
          action: "passenger.freeze.auto",
          entity: "User",
          entityId: passengerId,
          meta: {
            reason,
            from: "ACTIVE",
            to: "SUSPENDED",
            tripId: ctx.tripId,
            cancellations: ctx.total,
            windowDays: ctx.policy.windowDays,
            freezeThreshold: ctx.policy.freezeThreshold,
            source: "system.auto",
            unfreeze: "dashboard_only",
          },
        },
      })
      .catch(() => undefined);

    await this.notifications
      .dispatch({
        channel: "PUSH",
        userIds: [passengerId],
        title: "\u062a\u0645 \u062a\u062c\u0645\u064a\u062f \u062d\u0633\u0627\u0628\u0643 \u0645\u0624\u0642\u062a\u064b\u0627",
        body: "\u0628\u0633\u0628\u0628 \u0625\u0644\u063a\u0627\u0621\u0627\u062a \u0645\u062a\u0643\u0631\u0631\u0629 \u0644\u0627 \u064a\u0645\u0643\u0646\u0643 \u0637\u0644\u0628 \u0631\u062d\u0644\u0627\u062a \u062c\u062f\u064a\u062f\u0629 \u062d\u0627\u0644\u064a\u064b\u0627. \u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u064a \u063a\u0631\u0627\u0645\u0629 \u0645\u0627\u0644\u064a\u0629. \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u062f\u0639\u0645 \u0644\u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u062d\u0633\u0627\u0628.",
        data: { type: "account_frozen" },
      })
      .catch(() => undefined);

    this.logger.warn(
      `Passenger ${passengerId} auto-frozen after ${ctx.total} cancellations in ${ctx.policy.windowDays} days`,
    );
  }
}
