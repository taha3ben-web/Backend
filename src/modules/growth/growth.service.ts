import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DEFAULT_CURRENCY } from "../../common/money.util";
import {
  evaluateProgress,
  isIncentiveActive,
  IncentiveKind,
} from "./incentives.util";
import { assignVariant, validateVariants, Variant } from "./ab-testing.util";

export interface CreateIncentiveInput {
  name: string;
  kind: IncentiveKind;
  cityId?: string;
  targetValue: number;
  rewardMinor: number;
  currency?: string;
  startsAt: string | Date;
  endsAt: string | Date;
}

export interface CreateExperimentInput {
  key: string;
  name: string;
  description?: string;
  variants: Variant[];
}

@Injectable()
export class GrowthService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Incentives ----------

  async createIncentive(input: CreateIncentiveInput, createdBy?: string) {
    return this.prisma.incentive.create({
      data: {
        name: input.name,
        kind: input.kind as any,
        cityId: input.cityId ?? null,
        targetValue: input.targetValue,
        rewardMinor: input.rewardMinor,
        currency: input.currency ?? DEFAULT_CURRENCY,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        createdBy: createdBy ?? null,
      },
    });
  }

  async listIncentives(activeOnly = false) {
    const now = new Date();
    return this.prisma.incentive.findMany({
      where: activeOnly
        ? { active: true, startsAt: { lte: now }, endsAt: { gte: now } }
        : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /** يقيّم تقدّم سائق نحو حافز ويحفظ التقدّم، ويمنح المكافأة عند البلوغ. */
  async recordProgress(
    incentiveId: string,
    driverId: string,
    stats: {
      tripCount?: number;
      earningsMinor?: number;
      acceptanceRate?: number;
      streakDays?: number;
    },
  ) {
    const incentive = await this.prisma.incentive.findUniqueOrThrow({
      where: { id: incentiveId },
    });
    if (
      !isIncentiveActive(
        incentive.startsAt.getTime(),
        incentive.endsAt.getTime(),
        Date.now(),
      )
    ) {
      throw new BadRequestException("INCENTIVE_NOT_ACTIVE");
    }
    const result = evaluateProgress(
      incentive.kind as IncentiveKind,
      { target: incentive.targetValue, rewardMinor: incentive.rewardMinor },
      stats,
    );
    const existing = await this.prisma.driverIncentiveProgress.findUnique({
      where: { incentiveId_driverId: { incentiveId, driverId } },
    });
    const alreadyAwarded = existing?.awardedAt != null;
    return this.prisma.driverIncentiveProgress.upsert({
      where: { incentiveId_driverId: { incentiveId, driverId } },
      create: {
        incentiveId,
        driverId,
        progress: result.progress,
        target: result.target,
        achieved: result.achieved,
        rewardMinor: result.rewardMinor,
        awardedAt: result.achieved ? new Date() : null,
      },
      update: {
        progress: result.progress,
        achieved: result.achieved,
        rewardMinor: alreadyAwarded
          ? existing!.rewardMinor
          : result.rewardMinor,
        awardedAt:
          alreadyAwarded || !result.achieved
            ? (existing?.awardedAt ?? null)
            : new Date(),
      },
    });
  }

  // ---------- Pricing A/B experiments ----------

  async createExperiment(input: CreateExperimentInput, createdBy?: string) {
    if (!validateVariants(input.variants)) {
      throw new BadRequestException("INVALID_VARIANTS");
    }
    return this.prisma.pricingExperiment.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        variants: input.variants as any,
        createdBy: createdBy ?? null,
      },
    });
  }

  async listExperiments() {
    return this.prisma.pricingExperiment.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /**
   * يعيّن متغيّرًا حتميًا للهدف ويحفظه للاتساق. إذا وُجدت تعيين سابق يُعاد.
   */
  async assign(experimentKey: string, subjectId: string) {
    const experiment = await this.prisma.pricingExperiment.findUniqueOrThrow({
      where: { key: experimentKey },
    });
    if (!experiment.active) {
      throw new BadRequestException("EXPERIMENT_INACTIVE");
    }
    const existing = await this.prisma.experimentAssignment.findUnique({
      where: {
        experimentId_subjectId: { experimentId: experiment.id, subjectId },
      },
    });
    if (existing) return existing;
    const variant = assignVariant(
      experimentKey,
      subjectId,
      experiment.variants as unknown as Variant[],
    );
    return this.prisma.experimentAssignment.create({
      data: { experimentId: experiment.id, subjectId, variant },
    });
  }
}
