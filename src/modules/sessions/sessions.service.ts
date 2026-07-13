import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  async revoke(userId: string, id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.userId !== userId) {
      throw new NotFoundException("الجلسة غير موجودة");
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, sessionId: id, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.session.delete({ where: { id } }),
    ]);

    await this.safeRecordActivity(userId, "SESSION_REVOKE", {
      sessionId: id,
      scope: "self",
    });
    return { ok: true };
  }

  async revokeAll(userId: string, keepId?: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, id: keepId ? { not: keepId } : undefined },
      select: { id: true },
    });
    const sessionIds = sessions.map((item) => item.id);

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: keepId
          ? {
              userId,
              revoked: false,
              OR: [{ sessionId: { in: sessionIds } }, { sessionId: null }],
            }
          : { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.session.deleteMany({
        where: { userId, id: keepId ? { not: keepId } : undefined },
      }),
    ]);

    await this.safeRecordActivity(userId, "SESSION_REVOKE_ALL", {
      keptSessionId: keepId ?? null,
      revokedSessionCount: sessionIds.length,
      scope: "self",
    });
    return { ok: true };
  }

  listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  async revokeForUser(
    targetUserId: string,
    sessionId: string,
    actorUserId: string,
  ) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: targetUserId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException("الجلسة غير موجودة");
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId: targetUserId, sessionId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.session.delete({ where: { id: sessionId } }),
    ]);

    await this.safeRecordActivity(actorUserId, "SESSION_REVOKE_ADMIN", {
      targetUserId,
      sessionId,
      scope: "admin",
    });
    return { ok: true };
  }

  async revokeAllForUser(targetUserId: string, actorUserId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId: targetUserId },
      select: { id: true },
    });
    const sessionIds = sessions.map((item) => item.id);

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId: targetUserId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.session.deleteMany({ where: { userId: targetUserId } }),
    ]);

    await this.safeRecordActivity(actorUserId, "SESSION_REVOKE_ALL_ADMIN", {
      targetUserId,
      revokedSessionCount: sessionIds.length,
      scope: "admin",
    });
    return { ok: true };
  }

  private async safeRecordActivity(
    userId: string,
    action: string,
    meta: object,
  ) {
    try {
      await this.prisma.activityLog.create({
        data: { userId, action, meta },
      });
    } catch {
      // لا نكسر مسار الجلسات بسبب السجل.
    }
  }
}
