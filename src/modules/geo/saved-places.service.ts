import { Injectable } from "@nestjs/common";
import { Prisma, SavedPlaceKind } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import {
  CreateSavedPlaceDto,
  RecordRecentPlaceDto,
  UpdateSavedPlaceDto,
} from "./dto/geo.dto";

const MAX_RECENT_PLACES = 15;

/**
 * أماكن المستخدم المحفوظة (منزل/عمل/أخيرة/أخرى).
 * كل مستخدم يدير أماكنه فقط — مصدر الحقيقة في الباكند.
 */
@Injectable()
export class SavedPlacesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.savedPlace.findMany({
      where: { userId },
      orderBy: [{ kind: "asc" }, { lastUsedAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async create(userId: string, dto: CreateSavedPlaceDto) {
    const kind = dto.kind ?? SavedPlaceKind.OTHER;
    // HOME/WORK فريدان لكل مستخدم: نحدّث بدل التكرار.
    if (kind === SavedPlaceKind.HOME || kind === SavedPlaceKind.WORK) {
      const existing = await this.prisma.savedPlace.findFirst({
        where: { userId, kind },
        select: { id: true },
      });
      if (existing) {
        return this.prisma.savedPlace.update({
          where: { id: existing.id },
          data: {
            label: dto.label,
            address: dto.address,
            lat: dto.lat,
            lng: dto.lng,
            placeId: dto.placeId ?? null,
          },
        });
      }
    }
    return this.prisma.savedPlace.create({
      data: {
        userId,
        kind,
        label: dto.label,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        placeId: dto.placeId ?? null,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateSavedPlaceDto) {
    await this.ensureOwned(userId, id);
    const data: Prisma.SavedPlaceUpdateInput = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.placeId !== undefined) data.placeId = dto.placeId || null;
    return this.prisma.savedPlace.update({ where: { id }, data });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwned(userId, id);
    await this.prisma.savedPlace.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * يسجّل مكانًا أخيرًا (RECENT) ويُبقي آخر MAX_RECENT_PLACES فقط.
   * يدمج المواقع المتقاربة جدًا (نفس placeId أو إحداثيات مطابقة).
   */
  async recordRecent(userId: string, dto: RecordRecentPlaceDto) {
    const rounded = (n: number) => Number(n.toFixed(5));
    const duplicate = await this.prisma.savedPlace.findFirst({
      where: {
        userId,
        kind: SavedPlaceKind.RECENT,
        ...(dto.placeId
          ? { placeId: dto.placeId }
          : { lat: rounded(dto.lat), lng: rounded(dto.lng) }),
      },
      select: { id: true },
    });

    const place = duplicate
      ? await this.prisma.savedPlace.update({
          where: { id: duplicate.id },
          data: {
            label: dto.label,
            address: dto.address,
            lat: dto.lat,
            lng: dto.lng,
            placeId: dto.placeId ?? null,
            lastUsedAt: new Date(),
          },
        })
      : await this.prisma.savedPlace.create({
          data: {
            userId,
            kind: SavedPlaceKind.RECENT,
            label: dto.label,
            address: dto.address,
            lat: dto.lat,
            lng: dto.lng,
            placeId: dto.placeId ?? null,
            lastUsedAt: new Date(),
          },
        });

    await this.trimRecents(userId);
    return place;
  }

  private async trimRecents(userId: string) {
    const recents = await this.prisma.savedPlace.findMany({
      where: { userId, kind: SavedPlaceKind.RECENT },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true },
    });
    if (recents.length <= MAX_RECENT_PLACES) return;
    const stale = recents.slice(MAX_RECENT_PLACES).map((r) => r.id);
    await this.prisma.savedPlace.deleteMany({ where: { id: { in: stale } } });
  }

  private async ensureOwned(userId: string, id: string) {
    const place = await this.prisma.savedPlace.findUnique({ where: { id } });
    if (!place || place.userId !== userId) {
      throw new AppException("SAVED_PLACE_NOT_FOUND");
    }
    return place;
  }
}
