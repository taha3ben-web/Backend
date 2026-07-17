import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /** تسجيل (أو تحديث) توكن جهاز للمستخدم */
  async register(userId: string, token: string, platform: string) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  /** إزالة توكن (عند تسجيل الخروج) */
  async remove(token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token } });
    return { ok: true };
  }

  /** إزالة عدة توكنات (تنظيف التوكنات غير الصالحة التي رفضها FCM) */
  async removeMany(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    const res = await this.prisma.deviceToken.deleteMany({
      where: { token: { in: tokens } },
    });
    return res.count;
  }

  /** توكنات مجموعة مستخدمين */
  async tokensForUsers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }
}
