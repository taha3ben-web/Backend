import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../../prisma/prisma.service";

interface JwtPayload {
  sub: string;
  role: string;
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("jwt.accessSecret") as string,
    });
  }

  async validate(
    payload: JwtPayload,
  ): Promise<{ userId: string; role: string; sessionId?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, type: true, status: true },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }

    if (payload.sid) {
      const now = new Date();
      const threshold = new Date(now.getTime() - 5 * 60 * 1000);
      const touched = await this.prisma.session.updateMany({
        where: {
          id: payload.sid,
          userId: user.id,
          lastSeenAt: { lt: threshold },
        },
        data: { lastSeenAt: now },
      });

      if (touched.count === 0) {
        const exists = await this.prisma.session.findFirst({
          where: { id: payload.sid, userId: user.id },
          select: { id: true },
        });
        if (!exists) {
          throw new UnauthorizedException("Session is no longer active");
        }
      }

      return { userId: user.id, role: user.type, sessionId: payload.sid };
    }

    return { userId: user.id, role: user.type };
  }
}
