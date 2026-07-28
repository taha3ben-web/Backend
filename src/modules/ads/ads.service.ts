import { Injectable, NotFoundException } from "@nestjs/common";
import { AdPlacement } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateAdDto, UpdateAdDto } from "./dto/ad.dto";

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(placement?: AdPlacement, campaignKey?: string) {
    return this.prisma.advertisement.findMany({
      where: {
        ...(placement ? { placement } : {}),
        ...(campaignKey ? { campaignKey: campaignKey.trim() } : {}),
      },
      orderBy: [
        { priority: "desc" },
        { sortOrder: "asc" },
        { createdAt: "desc" },
      ],
    });
  }

  findActive(
    placement: AdPlacement,
    context?: {
      appId?: string;
      clientOs?: string;
      countryCode?: string;
      segments?: string[];
    },
  ) {
    const now = new Date();
    const appId = context?.appId?.trim();
    const clientOs = context?.clientOs?.trim().toLowerCase();
    const countryCode = context?.countryCode?.trim().toUpperCase();
    const segments = (context?.segments ?? []).map((item) =>
      item.toLowerCase(),
    );

    return this.prisma.advertisement.findMany({
      where: {
        isActive: true,
        OR: [{ placement }, { placement: "ALL" }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          {
            OR: [{ appId: null }, ...(appId ? [{ appId }] : [])],
          },
          {
            OR: [{ clientOs: null }, ...(clientOs ? [{ clientOs }] : [])],
          },
          countryCode
            ? {
                OR: [
                  { countryCodes: { isEmpty: true } },
                  { countryCodes: { has: countryCode } },
                ],
              }
            : { countryCodes: { isEmpty: true } },
          segments.length > 0
            ? {
                OR: [
                  { audienceSegments: { isEmpty: true } },
                  ...segments.map((segment) => ({
                    audienceSegments: { has: segment },
                  })),
                ],
              }
            : { audienceSegments: { isEmpty: true } },
        ],
      },
      orderBy: [
        { priority: "desc" },
        { sortOrder: "asc" },
        { createdAt: "desc" },
      ],
    });
  }

  async findOne(id: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException("الإعلان غير موجود");
    return ad;
  }

  create(dto: CreateAdDto) {
    return this.prisma.advertisement.create({
      data: {
        title: dto.title,
        imageUrl: dto.imageUrl,
        targetUrl: dto.targetUrl,
        campaignKey: dto.campaignKey?.trim() || null,
        placement: dto.placement ?? "PASSENGER_HOME",
        appId: dto.appId?.trim() || null,
        clientOs: dto.clientOs?.trim().toLowerCase() || null,
        countryCodes: this.normalizeArray(dto.countryCodes, "upper"),
        audienceSegments: this.normalizeArray(dto.audienceSegments, "lower"),
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        priority: dto.priority ?? 0,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateAdDto) {
    await this.findOne(id);
    return this.prisma.advertisement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.targetUrl !== undefined ? { targetUrl: dto.targetUrl } : {}),
        ...(dto.campaignKey !== undefined
          ? { campaignKey: dto.campaignKey?.trim() || null }
          : {}),
        ...(dto.placement !== undefined ? { placement: dto.placement } : {}),
        ...(dto.appId !== undefined
          ? { appId: dto.appId?.trim() || null }
          : {}),
        ...(dto.clientOs !== undefined
          ? { clientOs: dto.clientOs?.trim().toLowerCase() || null }
          : {}),
        ...(dto.countryCodes !== undefined
          ? { countryCodes: this.normalizeArray(dto.countryCodes, "upper") }
          : {}),
        ...(dto.audienceSegments !== undefined
          ? {
              audienceSegments: this.normalizeArray(
                dto.audienceSegments,
                "lower",
              ),
            }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }
          : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.advertisement.delete({ where: { id } });
    return { success: true };
  }

  private normalizeArray(
    values: string[] | undefined,
    casing: "upper" | "lower",
  ) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values ?? []) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      const next =
        casing === "upper" ? trimmed.toUpperCase() : trimmed.toLowerCase();
      if (seen.has(next)) continue;
      seen.add(next);
      result.push(next);
    }
    return result;
  }
}
