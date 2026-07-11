import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";
import { FirebaseAdminService } from "./firebase-admin.service";

export interface AuthUserResponse {
  id: string;
  name: string;
  phone: string;
  email?: string;
  type: "PASSENGER" | "DRIVER" | "STAFF";
  status: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: string;
  user: AuthUserResponse;
}

/**
 * يحوّل مدّة JWT النصية (مثل "30d"، "15m"، "7d"، "3600s") إلى ميلي ثانية.
 * يُستخدم لضبط expiresAt لرموز التحديث (إبطال فعلي بعد انتهاء المدة).
 */
function ttlToMs(ttl: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!m) return 30 * 24 * 60 * 60 * 1000; // افتراضي 30 يومًا
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  const mult =
    unit === "d"
      ? 24 * 60 * 60 * 1000
      : unit === "h"
        ? 60 * 60 * 1000
        : unit === "m"
          ? 60 * 1000
          : 1000;
  return n * mult;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  async register(dto: RegisterDto): Promise<Tokens> {
    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existing) throw new ForbiddenException("Phone already registered");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        passwordHash,
        type: dto.role,
        wallet: { create: {} },
        driver: dto.role === "DRIVER" ? { create: {} } : undefined,
      },
    });

    return this.issueTokens(user.id, user.type);
  }

  async login(dto: LoginDto): Promise<Tokens> {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (!user) throw new UnauthorizedException("Invalid credentials");

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");
    if (user.status === "BANNED")
      throw new ForbiddenException("Account banned");

    return this.issueTokens(user.id, user.type);
  }

  /**
   * جسر الهوية: يتحقّق من رمز Firebase ID، ثم يُنشئ/يجد المستخدم
   * المقابل في PostgreSQL، ويُصدر جلسة JWT خاصة بالخادم.
   * هذا يسمح للتطبيقين (اللذين يستخدمان Firebase Auth) بالاتصال
   * بـ WebSocket و REST دون إدارة كلمة مرور منفصلة.
   */
  async loginWithFirebase(dto: FirebaseLoginDto): Promise<Tokens> {
    const decoded = await this.firebase.verifyIdToken(dto.idToken);
    const firebaseUid = decoded.uid;
    const email = decoded.email ?? undefined;
    const emailVerified = decoded.email_verified === true;
    // الهاتف المُتحقَّق منه يأتي من Firebase فقط؛ dto.phone مُدخَل من
    // العميل (غير موثوق) ولا يُستخدم لمطابقة حساب قائم.
    const verifiedPhone = decoded.phone_number ?? undefined;
    const phone = verifiedPhone ?? dto.phone ?? undefined;
    const name =
      decoded.name ?? dto.name ?? (email ? email.split("@")[0] : "مستخدم NOVA");
    const role = dto.role ?? "PASSENGER";

    // 1) المطابقة مع حساب قائم تتم فقط عبر مُعرّفات موثوقة:
    //    firebaseUid، أو بريد مُتحقَّق منه، أو هاتف مُتحقَّق من Firebase.
    //    (منع الاستيلاء على الحساب عبر بريد/هاتف غير مُتحقَّق منه).
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { firebaseUid },
          ...(email && emailVerified ? [{ email }] : []),
          ...(verifiedPhone ? [{ phone: verifiedPhone }] : []),
        ],
      },
    });

    if (user) {
      if (user.status === "BANNED")
        throw new ForbiddenException("Account banned");
      // ربط firebaseUid إذا لم يكن مربوطًا بعد.
      if (!user.firebaseUid) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { firebaseUid },
        });
      }
    } else {
      // 2) إنشاء مستخدم جديد. لا توجد كلمة مرور (المصادقة عبر Firebase).
      const placeholderHash = await bcrypt.hash(`firebase:${firebaseUid}`, 10);
      // الهاتف حقل فريد وإلزامي → نولّد قيمة مؤقتة إذا لم يتوفر.
      const safePhone = phone ?? `fb_${firebaseUid.slice(0, 18)}`;
      user = await this.prisma.user.create({
        data: {
          name,
          phone: safePhone,
          email,
          firebaseUid,
          passwordHash: placeholderHash,
          type: role,
          wallet: { create: {} },
          driver: role === "DRIVER" ? { create: {} } : undefined,
        },
      });
    }

    return this.issueTokens(user.id, user.type);
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    let payload: { sub: string; role: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>("jwt.refreshSecret"),
      });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // نطابق الرمز المُقدّم مع أي رمز غير مُبطَل للمستخدم (وليس الأحدث
    // فقط) حتى تعمل الجلسات المتعددة (عدة أجهزة) بشكل صحيح.
    const candidates = await this.prisma.refreshToken.findMany({
      where: {
        userId: payload.sub,
        revoked: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });
    let stored: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(refreshToken, candidate.tokenHash)) {
        stored = candidate;
        break;
      }
    }
    if (!stored) throw new UnauthorizedException("Invalid refresh token");

    // Rotate: revoke old token then issue a fresh pair
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });
    return this.issueTokens(payload.sub, payload.role);
  }

  async logout(userId: string): Promise<{ ok: boolean }> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
    return { ok: true };
  }

  private async issueTokens(userId: string, role: string): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role },
      {
        secret: this.config.get<string>("jwt.accessSecret"),
        expiresIn: this.config.get<string>("jwt.accessTtl"),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, role },
      {
        secret: this.config.get<string>("jwt.refreshSecret"),
        expiresIn: this.config.get<string>("jwt.refreshTtl"),
      },
    );

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const refreshTtl = this.config.get<string>("jwt.refreshTtl") ?? "30d";
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlToMs(refreshTtl)),
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, email: true, type: true, status: true },
    });
    if (!user) throw new UnauthorizedException("User no longer exists");
    return {
      accessToken,
      refreshToken,
      userId,
      role,
      user: { ...user, email: user.email ?? undefined },
    };
  }
}
