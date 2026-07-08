import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * جلسات تسجيل الدخول (الأجهزة النشطة).
 * تُسجّل عند الدخول ويمكن للمستخدم إنهاؤها عن بُعد.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** تسجيل جلسة جديدة عند الدخول (بلا فشل إن أخفقت). */
  async record(userId: string, ip?: string | null, userAgent?: string | null) {
    try {
      return await this.prisma.session.create({
        data: {
          userId,
          ip: ip ?? null,
          userAgent: userAgent ?? null,
        },
      });
    } catch {
      return null;
    }
  }

  /** جلسات المستخدم الحالي */
  list(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  /** إنهاء جلسة واحدة يملكها المستخدم */
  async revoke(userId: string, id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException("الجلسة غير موجودة");
    }
    await this.prisma.session.delete({ where: { id } });
    return { ok: true };
  }

  /** إنهاء كل جلسات المستخدم عدا الحالية (إن وُجدت) */
  async revokeAll(userId: string, keepId?: string) {
    await this.prisma.session.deleteMany({
      where: { userId, id: keepId ? { not: keepId } : undefined },
    });
    return { ok: true };
  }

  /** للإدارة: جلسات مستخدم معيّن */
  listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });
  }
}
