import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateEmergencyContactDto,
  UpdateEmergencyContactDto,
} from "./dto/emergency.dto";

/**
 * جهات اتصال الطوارئ (SOS) للمستخدم.
 * كل مستخدم يدير جهاته الخاصة فقط.
 */
@Injectable()
export class EmergencyService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
  }

  create(userId: string, dto: CreateEmergencyContactDto) {
    return this.prisma.emergencyContact.create({
      data: {
        userId,
        name: dto.name,
        phone: dto.phone,
        relation: dto.relation ?? null,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateEmergencyContactDto) {
    await this.ensureOwned(userId, id);
    return this.prisma.emergencyContact.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        phone: dto.phone ?? undefined,
        relation: dto.relation ?? undefined,
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwned(userId, id);
    await this.prisma.emergencyContact.delete({ where: { id } });
    return { ok: true };
  }

  /** للإدارة: جهات طوارئ مستخدم معيّن */
  listForUser(userId: string) {
    return this.prisma.emergencyContact.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
  }

  private async ensureOwned(userId: string, id: string) {
    const contact = await this.prisma.emergencyContact.findUnique({
      where: { id },
    });
    if (!contact || contact.userId !== userId) {
      throw new NotFoundException("جهة الاتصال غير موجودة");
    }
    return contact;
  }
}
