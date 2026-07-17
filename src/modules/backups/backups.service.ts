import { Injectable } from "@nestjs/common";
import { BackupRecord, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import {
  ApplyRetentionDto,
  CreateBackupDto,
  DrStatusQueryDto,
  QueryBackupsDto,
  UpdateBackupDto,
} from "./dto/backup.dto";
import {
  DEFAULT_RETENTION_POLICY,
  RetentionPolicy,
  computeDrStatus,
  nextBackupDue,
  selectRetained,
} from "./backup-retention.util";

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * خدمة سجلّ النسخ الاحتياطية والتعافي من الكوارث.
 * تُسجّل ميتاداتا النسخ (تُنفّذ النسخ فعليًا خارجيًا)،
 * وتطبّق سياسة الاستبقاء، وتحسب حالة DR مقابل RPO.
 */
@Injectable()
export class BackupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryBackupsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BackupRecordWhereInput = {};
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.backupRecord.findMany({
        where,
        orderBy: [{ startedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.backupRecord.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<BackupRecord> {
    const record = await this.prisma.backupRecord.findUnique({ where: { id } });
    if (!record) throw new AppException("NOT_FOUND");
    return record;
  }

  private parseDate(value?: string): Date | null {
    if (!value || !value.trim()) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new AppException("VALIDATION_ERROR");
    return d;
  }

  async create(dto: CreateBackupDto, userId?: string): Promise<BackupRecord> {
    const status = dto.status ?? "PENDING";
    const completedAt = this.parseDate(dto.completedAt);
    return this.prisma.backupRecord.create({
      data: {
        kind: dto.kind ?? "DATABASE",
        trigger: dto.trigger ?? "MANUAL",
        status,
        storageLocation: dto.storageLocation?.trim() || null,
        sizeMb: dto.sizeMb ?? null,
        checksum: dto.checksum?.trim() || null,
        completedAt:
          completedAt ?? (status === "COMPLETED" ? new Date() : null),
        error: dto.error?.trim() || null,
        triggeredById: userId ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateBackupDto): Promise<BackupRecord> {
    await this.findOne(id);
    const completedAt =
      dto.completedAt === undefined
        ? undefined
        : this.parseDate(dto.completedAt);
    const data: Prisma.BackupRecordUpdateInput = {
      status: dto.status,
      storageLocation:
        dto.storageLocation === undefined
          ? undefined
          : dto.storageLocation?.trim() || null,
      sizeMb: dto.sizeMb,
      checksum:
        dto.checksum === undefined ? undefined : dto.checksum?.trim() || null,
      error: dto.error === undefined ? undefined : dto.error?.trim() || null,
    };
    if (dto.completedAt !== undefined) {
      data.completedAt = completedAt;
    } else if (dto.status === "COMPLETED") {
      data.completedAt = new Date();
    }
    return this.prisma.backupRecord.update({ where: { id }, data });
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    await this.findOne(id);
    await this.prisma.backupRecord.delete({ where: { id } });
    return { id, deleted: true };
  }

  private resolvePolicy(dto?: ApplyRetentionDto): RetentionPolicy {
    return {
      keepLatest:
        dto?.keepLatest ??
        envInt("BACKUP_RETENTION_KEEP_LATEST", DEFAULT_RETENTION_POLICY.keepLatest),
      keepDaily:
        dto?.keepDaily ??
        envInt("BACKUP_RETENTION_KEEP_DAILY", DEFAULT_RETENTION_POLICY.keepDaily),
      keepWeekly:
        dto?.keepWeekly ??
        envInt("BACKUP_RETENTION_KEEP_WEEKLY", DEFAULT_RETENTION_POLICY.keepWeekly),
      keepMonthly:
        dto?.keepMonthly ??
        envInt(
          "BACKUP_RETENTION_KEEP_MONTHLY",
          DEFAULT_RETENTION_POLICY.keepMonthly,
        ),
    };
  }

  /** يطبّق سياسة الاستبقاء على النسخ المكتملة (دون حذف فعلي للتخزين). */
  async applyRetention(dto?: ApplyRetentionDto) {
    const policy = this.resolvePolicy(dto);
    const dryRun = dto?.dryRun === "true";
    const completed = await this.prisma.backupRecord.findMany({
      where: { status: "COMPLETED" },
      select: { id: true, completedAt: true, startedAt: true },
      orderBy: { startedAt: "desc" },
    });
    const candidates = completed.map((b) => ({
      id: b.id,
      timestamp: b.completedAt ?? b.startedAt,
    }));
    const { retainIds, pruneIds } = selectRetained(candidates, policy);
    if (!dryRun && (retainIds.length > 0 || pruneIds.length > 0)) {
      await this.prisma.$transaction([
        this.prisma.backupRecord.updateMany({
          where: { id: { in: retainIds } },
          data: { retained: true },
        }),
        this.prisma.backupRecord.updateMany({
          where: { id: { in: pruneIds } },
          data: { retained: false },
        }),
      ]);
    }
    return {
      policy,
      dryRun,
      applied: !dryRun,
      retainCount: retainIds.length,
      pruneCount: pruneIds.length,
      retainIds,
      pruneIds,
    };
  }

  /** حالة التعافي من الكوارث: عمر آخر نسخة ناجحة مقابل RPO. */
  async drStatus(query: DrStatusQueryDto) {
    const rpoMinutes =
      query.rpoMinutes ?? envInt("BACKUP_RPO_MINUTES", 1440);
    const intervalMinutes = envInt("BACKUP_INTERVAL_MINUTES", 1440);
    const last = await this.prisma.backupRecord.findFirst({
      where: {
        status: "COMPLETED",
        ...(query.kind ? { kind: query.kind } : {}),
      },
      orderBy: { completedAt: "desc" },
    });
    const lastAt = last?.completedAt ?? null;
    const now = new Date();
    const status = computeDrStatus(now, lastAt, rpoMinutes);
    const due = nextBackupDue(lastAt, intervalMinutes);
    return {
      ...status,
      intervalMinutes,
      nextBackupDue: due ? due.toISOString() : null,
      lastBackup: last
        ? {
            id: last.id,
            kind: last.kind,
            sizeMb: last.sizeMb,
            storageLocation: last.storageLocation,
            completedAt: last.completedAt,
          }
        : null,
    };
  }
}
