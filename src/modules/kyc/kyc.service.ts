import { Injectable, Logger } from "@nestjs/common";
import {
  IdentityVerificationStatus,
  Prisma,
  UserIdentityVerification,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AppException } from "../../common/api/app.exception";
import { ReviewKycDto, SubmitKycDto } from "./dto/kyc.dto";
import {
  canSubmit,
  effectiveStatus,
  normalizeDocNumber,
  resolveExpiry,
} from "./kyc.util";

/**
 * تحقق هوية المستخدم (KYC): تقديم الطلب ومراجعته الإدارية (موافقة/رفض).
 * مستقل تمامًا عن وثائق السائقين والرحلات والتسعير — إضافي بالكامل.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** أحدث سجل تحقق للمستخدم (إن وُجد). */
  private latestFor(userId: string) {
    return this.prisma.userIdentityVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getMySubmission(userId: string) {
    const record = await this.latestFor(userId);
    return { record, status: effectiveStatus(record) };
  }

  async submit(
    userId: string,
    dto: SubmitKycDto,
  ): Promise<UserIdentityVerification> {
    const latest = await this.latestFor(userId);
    if (!canSubmit(latest)) {
      if (effectiveStatus(latest) === "PENDING") {
        throw new AppException("KYC_ALREADY_PENDING");
      }
      throw new AppException("KYC_ALREADY_VERIFIED");
    }
    return this.prisma.userIdentityVerification.create({
      data: {
        userId,
        docType: dto.docType,
        docNumber: normalizeDocNumber(dto.docNumber),
        frontUrl: dto.frontUrl,
        backUrl: dto.backUrl ?? null,
        selfieUrl: dto.selfieUrl ?? null,
        status: "PENDING",
      },
    });
  }

  async getOrThrow(id: string): Promise<UserIdentityVerification> {
    const record = await this.prisma.userIdentityVerification.findUnique({
      where: { id },
    });
    if (!record) throw new AppException("KYC_NOT_FOUND");
    return record;
  }

  async adminList(q: PaginationDto, status?: IdentityVerificationStatus) {
    const where: Prisma.UserIdentityVerificationWhereInput = status
      ? { status }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.userIdentityVerification.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, phone: true } },
        },
      }),
      this.prisma.userIdentityVerification.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async approve(
    id: string,
    reviewedById: string,
    dto: ReviewKycDto,
  ): Promise<UserIdentityVerification> {
    const record = await this.getOrThrow(id);
    if (record.status !== "PENDING") {
      throw new AppException("KYC_INVALID_STATUS");
    }
    const now = new Date();
    return this.prisma.userIdentityVerification.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedById,
        reviewedAt: now,
        note: dto.note ?? null,
        expiresAt: resolveExpiry(now, dto.expiresInDays),
      },
    });
  }

  async reject(
    id: string,
    reviewedById: string,
    dto: ReviewKycDto,
  ): Promise<UserIdentityVerification> {
    const record = await this.getOrThrow(id);
    if (record.status !== "PENDING") {
      throw new AppException("KYC_INVALID_STATUS");
    }
    return this.prisma.userIdentityVerification.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedById,
        reviewedAt: new Date(),
        note: dto.note ?? null,
      },
    });
  }
}
