import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}
  async register(userId: string, token: string, platform: string) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }
  async remove(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { ok: true };
  }
  async removeMany(tokens: string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    return (
      await this.prisma.deviceToken.deleteMany({
        where: { token: { in: tokens } },
      })
    ).count;
  }
  async tokensForUsers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    return (
      await this.prisma.deviceToken.findMany({
        where: { userId: { in: userIds } },
        select: { token: true },
      })
    ).map((row) => row.token);
  }
}
