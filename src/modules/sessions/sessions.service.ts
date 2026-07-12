import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }],
    });
  }

  async revoke(userId: string, id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException("الجلسة غير موجودة");
    }
    await this.prisma.refreshToken.updateMany({
      where: { sessionId: id, revoked: false },
      data: { revoked: true, lastUsedAt: new Date() },
    });
    await this.prisma.session.update({
      where: { id },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED" },
    });
    return { ok: true };
  }

  async revokeAll(userId: string, keepId?: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revoked: false,
        sessionId: keepId ? { not: keepId } : undefined,
      },
      data: { revoked: true, lastUsedAt: new Date() },
    });
    await this.prisma.session.updateMany({
      where: { userId, id: keepId ? { not: keepId } : undefined, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "USER_REVOKED_ALL" },
    });
    return { ok: true };
  }

  listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }],
    });
  }
}
