import { Injectable } from "@nestjs/common";
import { ContentBlock, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import {
  CreateContentBlockDto,
  PublicContentQueryDto,
  QueryContentBlocksDto,
  UpdateContentBlockDto,
} from "./dto/content-block.dto";
import {
  isValidWindow,
  normalizeAudience,
  normalizeLocale,
  normalizeSlug,
} from "./content-block.util";

/**
 * خدمة كتل المحتوى: CRUD كامل يُدار من لوحة التحكم + قائمة عامة
 * للمحتوى الحيّ (داخل النافذة والجمهور المطلوب) يستهلكها التطبيق.
 * لا تحتوي أي تسعير أو خصم.
 */
@Injectable()
export class ContentBlocksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryContentBlocksDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ContentBlockWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.audience) where.audience = query.audience;
    if (query.locale) where.locale = normalizeLocale(query.locale);
    if (query.isActive === "true") where.isActive = true;
    if (query.isActive === "false") where.isActive = false;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { slug: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contentBlock.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { slug: "asc" }, { locale: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contentBlock.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<ContentBlock> {
    const block = await this.prisma.contentBlock.findUnique({ where: { id } });
    if (!block) throw new AppException("NOT_FOUND");
    return block;
  }

  private parseDate(value?: string): Date | null {
    if (!value || !value.trim()) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new AppException("VALIDATION_ERROR");
    return d;
  }

  async create(
    dto: CreateContentBlockDto,
    userId?: string,
  ): Promise<ContentBlock> {
    const slug = normalizeSlug(dto.slug);
    if (!slug) throw new AppException("VALIDATION_ERROR");
    const locale = normalizeLocale(dto.locale);
    const audience = dto.audience ?? "ALL";
    const startsAt = this.parseDate(dto.startsAt);
    const endsAt = this.parseDate(dto.endsAt);
    if (!isValidWindow(startsAt, endsAt)) {
      throw new AppException("VALIDATION_ERROR");
    }
    const exists = await this.prisma.contentBlock.findUnique({
      where: { slug_locale_audience: { slug, locale, audience } },
    });
    if (exists) throw new AppException("CONFLICT");
    return this.prisma.contentBlock.create({
      data: {
        slug,
        locale,
        audience,
        type: dto.type ?? "INFO",
        title: dto.title,
        body: dto.body,
        imageUrl: dto.imageUrl?.trim() || null,
        ctaLabel: dto.ctaLabel?.trim() || null,
        ctaUrl: dto.ctaUrl?.trim() || null,
        tags: dto.tags ?? [],
        startsAt,
        endsAt,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
    });
  }

  async update(
    id: string,
    dto: UpdateContentBlockDto,
    userId?: string,
  ): Promise<ContentBlock> {
    const current = await this.findOne(id);
    const startsAt =
      dto.startsAt === undefined ? current.startsAt : this.parseDate(dto.startsAt);
    const endsAt =
      dto.endsAt === undefined ? current.endsAt : this.parseDate(dto.endsAt);
    if (!isValidWindow(startsAt, endsAt)) {
      throw new AppException("VALIDATION_ERROR");
    }
    return this.prisma.contentBlock.update({
      where: { id },
      data: {
        type: dto.type,
        title: dto.title,
        body: dto.body,
        imageUrl:
          dto.imageUrl === undefined ? undefined : dto.imageUrl?.trim() || null,
        ctaLabel:
          dto.ctaLabel === undefined ? undefined : dto.ctaLabel?.trim() || null,
        ctaUrl:
          dto.ctaUrl === undefined ? undefined : dto.ctaUrl?.trim() || null,
        tags: dto.tags,
        startsAt: dto.startsAt === undefined ? undefined : startsAt,
        endsAt: dto.endsAt === undefined ? undefined : endsAt,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        updatedById: userId ?? null,
      },
    });
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    await this.findOne(id);
    await this.prisma.contentBlock.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** قائمة المحتوى الحيّ للتطبيق (مفعّل + داخل النافذة + جمهور مطابق). */
  async listPublic(query: PublicContentQueryDto): Promise<ContentBlock[]> {
    const now = new Date();
    const audience = normalizeAudience(query.audience);
    const where: Prisma.ContentBlockWhereInput = {
      isActive: true,
      ...(query.type ? { type: query.type } : {}),
      ...(query.locale ? { locale: normalizeLocale(query.locale) } : {}),
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ...(audience && audience !== "ALL"
          ? [{ OR: [{ audience: "ALL" as const }, { audience }] }]
          : []),
      ],
    };
    return this.prisma.contentBlock.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }
}
