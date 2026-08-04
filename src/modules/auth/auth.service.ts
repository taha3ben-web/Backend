import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";
import { FirebaseAdminService } from "./firebase-admin.service";
import { CountryConfigService } from "../country-config/country-config.service";
import { AppException } from "../../common/api/app.exception";
import { LoginThrottleService } from "./login-throttle.service";
import { OtpService } from "./otp.service";
import { RequestOtpDto, VerifyOtpDto } from "./dto/otp.dto";
import { normalizePurpose } from "./otp.util";

export interface AuthUserResponse {
  id: string;
  name: string;
  username?: string | null;
  phone: string;
  email?: string;
  type: "PASSENGER" | "DRIVER" | "STAFF" | "AGENT";
  status: string;
}

export interface AuthRoleResponse {
  id: string;
  name: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: string;
  user: AuthUserResponse;
  permissions: string[];
  staffRole?: AuthRoleResponse | null;
}

interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * يحوّل مدّة JWT النصية (مثل "30d"، "15m"، "7d"، "3600s") إلى ميلي ثانية.
 * يُستخدم لضبط expiresAt لرموز التحديث (إبطال فعلي بعد انتهاء المدة).
 */
function ttlToMs(ttl: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!m) return 30 * 24 * 60 * 60 * 1000;
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
    private readonly countryConfig: CountryConfigService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly otp: OtpService,
  ) {}

  /**
   * يطلب رمز OTP لرقم هاتف (يُطبّق أولاً). إضافي ومستقل — لا يغير
   * سلوك register/login القائم.
   */
  async requestPhoneOtp(
    dto: RequestOtpDto,
  ): Promise<{ sent: boolean; expiresInSeconds: number }> {
    const phone = await this.normalizedPhone(dto.phone, dto.countryCode);
    return this.otp.requestOtp(phone, normalizePurpose(dto.purpose));
  }

  /** يتحقق من رمز OTP لرقم هاتف (يُطبّق أولاً). */
  async verifyPhoneOtp(dto: VerifyOtpDto): Promise<{ verified: true }> {
    const phone = await this.normalizedPhone(dto.phone, dto.countryCode);
    return this.otp.verifyOtp(phone, normalizePurpose(dto.purpose), dto.code);
  }

  private async normalizedPhone(
    phone: string,
    countryCode?: string,
  ): Promise<string> {
    const code = (
      countryCode ??
      this.config.get<string>("DEFAULT_COUNTRY_CODE") ??
      "DZ"
    ).toUpperCase();
    const normalized = await this.countryConfig.normalizePhone(code, phone);
    if (!normalized) {
      throw new AppException("INVALID_PHONE_NUMBER", {
        details: { countryCode: code },
      });
    }
    return normalized;
  }

  async register(dto: RegisterDto, session?: SessionContext): Promise<Tokens> {
    const phone = await this.normalizedPhone(dto.phone, dto.countryCode);
    const existing = await this.prisma.user.findUnique({
      where: { phone },
    });
    if (existing) throw new AppException("PHONE_ALREADY_REGISTERED");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        phone,
        email: dto.email,
        passwordHash,
        type: dto.role,
        driver: dto.role === "DRIVER" ? { create: {} } : undefined,
      },
    });

    const sessionId = await this.createSession(user.id, session);
    await this.safeRecordActivity(
      user.id,
      "AUTH_REGISTER",
      session?.ip ?? null,
      {
        sessionId: sessionId ?? null,
        role: dto.role,
        userAgent: session?.userAgent ?? null,
      },
    );
    return this.issueTokens(user.id, sessionId);
  }

  async login(dto: LoginDto, session?: SessionContext): Promise<Tokens> {
    const username = dto.username?.trim().toLowerCase();
    const phone = username
      ? undefined
      : await this.normalizedPhone(dto.phone ?? "", dto.countryCode);
    const loginKey = username ? `username:${username}` : (phone as string);
    // حماية من القوة الغاشمة: نرفض فورًا إن كان هذا الحساب مقفولًا مؤقتًا.
    await this.loginThrottle.assertNotLocked(loginKey);

    const user = username
      ? await this.prisma.user.findUnique({ where: { username } })
      : await this.prisma.user.findUnique({
          where: { phone: phone as string },
        });
    if (!user) {
      // نعدّ المحاولة حتى لرقم غير مسجّل لمنع التخمين المتسلسل.
      await this.loginThrottle.recordFailure(loginKey);
      throw new AppException("INVALID_CREDENTIALS");
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.loginThrottle.recordFailure(loginKey);
      throw new AppException("INVALID_CREDENTIALS");
    }
    if (user.status !== "ACTIVE") {
      throw new AppException("ACCOUNT_INACTIVE");
    }

    // نجاح: نمسح عدّاد الفشل والقفل عن هذا الحساب.
    await this.loginThrottle.recordSuccess(loginKey);

    const sessionId = await this.createSession(user.id, session);
    await this.markAgentLogin(user.id, user.type);
    await this.safeRecordActivity(user.id, "AUTH_LOGIN", session?.ip ?? null, {
      sessionId: sessionId ?? null,
      userAgent: session?.userAgent ?? null,
    });
    return this.issueTokens(user.id, sessionId);
  }

  /**
   * جسر الهوية: يتحقّق من رمز Firebase ID، ثم يُنشئ/يجد المستخدم
   * المقابل في PostgreSQL، ويُصدر جلسة JWT خاصة بالخادم.
   */
  async loginWithFirebase(
    dto: FirebaseLoginDto,
    session?: SessionContext,
  ): Promise<Tokens> {
    const decoded = await this.firebase.verifyIdToken(dto.idToken);
    const firebaseUid = decoded.uid;
    const email = decoded.email ?? undefined;
    const emailVerified = decoded.email_verified === true;
    const verifiedPhone = decoded.phone_number ?? undefined;
    // لا نثق أبدًا برقم الهاتف القادم من العميل: لو خُزن رقم غير مُتحقّق منه
    // لأمكن لاحقًا لمالك الرقم الحقيقي أن يرتبط بحساب أنشأه شخص آخر.
    const phone = verifiedPhone;
    // Firebase Phone Auth هي قناة التحقق الوحيدة، فلا نقبل رمزًا بلا هوية مُتحقّقة.
    if (!verifiedPhone && !(email && emailVerified)) {
      throw new UnauthorizedException(
        "رمز Firebase لا يحمل رقم هاتف أو بريدًا مُتحقّقًا",
      );
    }
    const name =
      decoded.name ?? dto.name ?? (email ? email.split("@")[0] : "مستخدم NOVA");
    const role = dto.role ?? "PASSENGER";

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
      if (user.status !== "ACTIVE") {
        throw new ForbiddenException("Account is not active");
      }
      if (!user.firebaseUid) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { firebaseUid },
        });
      }
    } else {
      const unusablePasswordHash = await bcrypt.hash(
        `firebase:${firebaseUid}`,
        10,
      );
      const safePhone = phone ?? `fb_${firebaseUid.slice(0, 18)}`;
      user = await this.prisma.user.create({
        data: {
          name,
          phone: safePhone,
          email,
          firebaseUid,
          passwordHash: unusablePasswordHash,
          type: role,
          driver: role === "DRIVER" ? { create: {} } : undefined,
        },
      });
    }

    const sessionId = await this.createSession(user.id, session);
    await this.markAgentLogin(user.id, user.type);
    await this.safeRecordActivity(
      user.id,
      "AUTH_LOGIN_FIREBASE",
      session?.ip ?? null,
      {
        sessionId: sessionId ?? null,
        firebaseUid,
        userAgent: session?.userAgent ?? null,
      },
    );
    return this.issueTokens(user.id, sessionId);
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    let payload: { sub: string; role: string; sid?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>("jwt.refreshSecret"),
      });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const candidates = await this.prisma.refreshToken.findMany({
      where: {
        userId: payload.sub,
        revoked: false,
        ...(payload.sid ? { sessionId: payload.sid } : {}),
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

    const sessionId = stored.sessionId ?? payload.sid ?? undefined;
    if (sessionId) {
      const session = await this.prisma.session.findFirst({
        where: { id: sessionId, userId: payload.sub },
        select: { id: true },
      });
      if (!session) {
        await this.prisma.refreshToken.update({
          where: { id: stored.id },
          data: { revoked: true },
        });
        throw new UnauthorizedException("Session is no longer active");
      }
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });
    await this.safeRecordActivity(payload.sub, "AUTH_REFRESH", null, {
      sessionId: sessionId ?? null,
    });
    return this.issueTokens(payload.sub, sessionId);
  }

  /**
   * تغيير كلمة المرور من داخل الحساب — نفس تخزين bcryptjs المستخدم في
   * register/login، دون أي نظام مصادقة موازٍ.
   *
   * بعد التغيير تُنهى الجلسات الأخرى (وتُبطَل رموز التحديث) ما لم يطلب
   * العميل خلاف ذلك، مع الإبقاء على الجلسة الحالية.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    sessionId?: string,
  ): Promise<{ ok: boolean; otherSessionsRevoked: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException("User no longer exists");
    if (user.status !== "ACTIVE") throw new AppException("ACCOUNT_INACTIVE");

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new AppException("INVALID_CREDENTIALS");

    const same = await bcrypt.compare(dto.newPassword, user.passwordHash);
    if (same) {
      throw new AppException("VALIDATION_ERROR", {
        details: { newPassword: "must differ from the current password" },
      });
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    const revokeOthers = dto.revokeOtherSessions !== false;
    if (revokeOthers) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: sessionId
            ? { userId, revoked: false, NOT: { sessionId } }
            : { userId, revoked: false },
          data: { revoked: true },
        }),
        this.prisma.session.deleteMany({
          where: sessionId ? { userId, NOT: { id: sessionId } } : { userId },
        }),
      ]);
    }

    await this.safeRecordActivity(userId, "AUTH_PASSWORD_CHANGE", null, {
      sessionId: sessionId ?? null,
      otherSessionsRevoked: revokeOthers,
    });

    return { ok: true, otherSessionsRevoked: revokeOthers };
  }

  async logout(userId: string, sessionId?: string): Promise<{ ok: boolean }> {
    if (sessionId) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { userId, sessionId, revoked: false },
          data: { revoked: true },
        }),
        this.prisma.session.deleteMany({ where: { id: sessionId, userId } }),
      ]);
      await this.safeRecordActivity(userId, "AUTH_LOGOUT", null, { sessionId });
      return { ok: true };
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
    await this.safeRecordActivity(userId, "AUTH_LOGOUT_ALL", null);
    return { ok: true };
  }

  async me(userId: string): Promise<{
    userId: string;
    role: string;
    user: AuthUserResponse;
    permissions: string[];
    staffRole?: AuthRoleResponse | null;
  }> {
    const authData = await this.loadAuthData(userId);
    if (!authData) throw new UnauthorizedException("User no longer exists");
    if (authData.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }

    return {
      userId: authData.user.id,
      role: authData.user.type,
      user: authData.user,
      permissions: authData.permissions,
      staffRole: authData.staffRole,
    };
  }

  private async issueTokens(
    userId: string,
    sessionId?: string,
  ): Promise<Tokens> {
    const authData = await this.loadAuthData(userId);
    if (!authData) throw new UnauthorizedException("User no longer exists");
    if (authData.user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }
    const actualRole = authData.user.type;

    const payload = sessionId
      ? { sub: userId, role: actualRole, sid: sessionId }
      : { sub: userId, role: actualRole };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>("jwt.accessSecret"),
      expiresIn: this.config.get<string>("jwt.accessTtl"),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>("jwt.refreshSecret"),
      expiresIn: this.config.get<string>("jwt.refreshTtl"),
    });

    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const refreshTtl = this.config.get<string>("jwt.refreshTtl") ?? "30d";
    await this.prisma.refreshToken.create({
      data: {
        userId,
        sessionId,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlToMs(refreshTtl)),
      },
    });

    return {
      accessToken,
      refreshToken,
      userId,
      role: actualRole,
      user: authData.user,
      permissions: authData.permissions,
      staffRole: authData.staffRole,
    };
  }

  private async createSession(
    userId: string,
    session?: SessionContext,
  ): Promise<string | undefined> {
    try {
      const created = await this.prisma.session.create({
        data: {
          userId,
          ip: session?.ip ?? null,
          userAgent: session?.userAgent ?? null,
        },
        select: { id: true },
      });
      return created.id;
    } catch {
      return undefined;
    }
  }

  private async markAgentLogin(
    userId: string,
    userType: string,
  ): Promise<void> {
    if (userType !== "AGENT") return;
    try {
      await this.prisma.agentProfile.update({
        where: { userId },
        data: { lastLoginAt: new Date() },
      });
    } catch {
      // لا نكسر تسجيل الدخول إذا كان ملف الوكيل ناقصًا.
    }
  }

  private async safeRecordActivity(
    userId: string | null,
    action: string,
    ip?: string | null,
    meta?: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: { userId, action, ip: ip ?? null, meta },
      });
    } catch {
      // لا نكسر التدفق الرئيسي بسبب السجل.
    }
  }

  private async loadAuthData(userId: string): Promise<{
    user: AuthUserResponse;
    permissions: string[];
    staffRole?: AuthRoleResponse | null;
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        type: true,
        status: true,
        staffRole: {
          select: {
            id: true,
            name: true,
            permissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    });

    if (!user) return null;

    const permissions = user.staffRole
      ? user.staffRole.permissions.map((item) => item.permission.key)
      : [];

    return {
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email ?? undefined,
        type: user.type,
        status: user.status,
      },
      permissions,
      staffRole: user.staffRole
        ? { id: user.staffRole.id, name: user.staffRole.name }
        : null,
    };
  }
}
