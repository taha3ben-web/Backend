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
      select: {
        id: true,
        type: true,
        status: true,
        driver: { select: { id: true } },
      },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }

    // حساب واحد يمكن أن يحمل دورين (راكب وسائق)، فدور الجلسة هو ما وُقّع
    // فـ التوكن وقت الدخول - ماشي `user.type` الثابت. لكن يبقى تحقّق حيّ:
    // - DRIVER: يشترط وجود ملف سائق فعلي الآن (لو حُذف/أُلغي بعد إصدار
    //   التوكن، الجلسة تفقد صلاحية DRIVER فورًا، بلا انتظار انتهاء التوكن).
    // - أي دور غير DRIVER (STAFF/AGENT وأيضًا PASSENGER الصادر من مسار
    //   register/login القديم) يبقى مربوطًا بـ `user.type` الحي كما كان
    //   دائمًا - لا صلاحية ذاتية للترقية هنا.
    let role = payload.role;
    if (role === "DRIVER") {
      if (!user.driver) {
        throw new UnauthorizedException("Driver profile no longer available");
      }
    } else if (role !== user.type) {
      role = user.type;
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

      return { userId: user.id, role, sessionId: payload.sid };
    }

    return { userId: user.id, role };
  }
}
