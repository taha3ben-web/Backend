import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import { ChangePasswordDto } from "./dto/change-password.dto";

@Injectable()
export class PasswordService {
  constructor(private readonly prisma: PrismaService) {}

  async changePassword(
    userId: string,
    sessionId: string | undefined,
    dto: ChangePasswordDto,
  ): Promise<{ ok: true; otherSessionsRevoked: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, status: true },
    });
    if (!user) throw new UnauthorizedException("User no longer exists");
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("Account is not active");
    }

    // المرحلة ج جعلت currentPassword اختياريًا في ChangePasswordDto لأجل سائقي Firebase
    // الذين لا يملكون كلمة مرور حقيقية بعد. هذه الخدمة غير مستخدمة
    // حاليًا (المسار الحيّ هو AuthService.changePassword)، ولا تدعم منطق
    // السنتينل، فترفض الطلب صراحةً بدل تمرير undefined إلى bcrypt.
    if (!dto.currentPassword) {
      throw new AppException("VALIDATION_ERROR", {
        details: { currentPassword: "required" },
      });
    }

    const currentMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentMatches) throw new AppException("INVALID_CREDENTIALS");

    const passwordUnchanged = await bcrypt.compare(
      dto.newPassword,
      user.passwordHash,
    );
    if (passwordUnchanged) {
      throw new BadRequestException(
        "New password must be different from the current password",
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    const revokeOtherSessions = dto.revokeOtherSessions !== false;
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
    ];

    if (revokeOtherSessions) {
      operations.push(
        this.prisma.refreshToken.updateMany({
          where: {
            userId,
            revoked: false,
            ...(sessionId
              ? { OR: [{ sessionId: null }, { sessionId: { not: sessionId } }] }
              : {}),
          },
          data: { revoked: true },
        }),
        this.prisma.session.deleteMany({
          where: {
            userId,
            ...(sessionId ? { id: { not: sessionId } } : {}),
          },
        }),
      );
    }

    operations.push(
      this.prisma.auditLog.create({
        data: {
          actorId: userId,
          action: "USER_PASSWORD_CHANGED",
          entity: "User",
          entityId: userId,
          meta: {
            revokedOtherSessions: revokeOtherSessions,
            sessionId: sessionId ?? null,
          },
        },
      }),
    );

    await this.prisma.$transaction(operations);
    return { ok: true, otherSessionsRevoked: revokeOtherSessions };
  }
}
