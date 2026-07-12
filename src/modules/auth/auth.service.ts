import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";
import { FirebaseAdminService } from "./firebase-admin.service";
import { DeviceContextDto } from "./dto/device-context.dto";

export interface AuthUserResponse {
  id: string;
  name: string;
  username?: string;
  phone: string;
  email?: string;
  type: "PASSENGER" | "DRIVER" | "STAFF" | "AGENT";
  status: string;
}

export interface AuthRoleSummary {
  id?: string;
  name?: string;
  permissions: string[];
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: string;
  sessionId: string;
  user: AuthUserResponse;
  staffRole?: AuthRoleSummary;
  permissions: string[];
}

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
  device?: DeviceContextDto;
}

interface RefreshPayload {
  sub: string;
  role: string;
  sid?: string;
}

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
  ) {}

  async register(dto: RegisterDto, ctx: SessionContext = {}): Promise<Tokens> {
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

    const session = await this.startSession(user.id, ctx);
    const tokens = await this.issueTokens(user.id, user.type, session.id);
    await this.recordActivity(user.id, "auth.register", ctx, {
      role: dto.role,
      sessionId: session.id,
    });
    return tokens;
  }

  async login(dto: LoginDto, ctx: SessionContext = {}): Promise<Tokens> {
    const rawIdentifier = dto.phone.trim();
    const normalizedIdentifier = rawIdentifier.toLowerCase();
    const developmentAdminAlias = ["admin", "0000000000"].includes(
      normalizedIdentifier,
    );

    if (!rawIdentifier) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: rawIdentifier },
          { username: { equals: normalizedIdentifier, mode: "insensitive" } },
          { email: { equals: normalizedIdentifier, mode: "insensitive" } },
          ...(developmentAdminAlias
            ? [
                {
                  type: "STAFF" as const,
                  staffRole: { is: { name: "SUPER_ADMIN" } },
                },
              ]
            : []),
        ],
      },
    });
    if (!user) {
      await this.recordActivity(null, "auth.login_failed", ctx, {
        identifier: rawIdentifier,
      });
      throw new UnauthorizedException("Invalid credentials");
    }

    // دخول تطوير مؤقت: حساب admin لا يحتاج كلمة مرور.
    const passwordlessDevelopmentAdmin =
      developmentAdminAlias && user.type === "STAFF";
    const ok = passwordlessDevelopmentAdmin
      ? true
      : dto.password
        ? await bcrypt.compare(dto.password, user.passwordHash)
        : false;
    if (!ok) {
      await this.recordActivity(null, "auth.login_failed", ctx, {
        identifier: rawIdentifier,
      });
      throw new UnauthorizedException("Invalid credentials");
    }
    if (user.status === "BANNED") {
      throw new ForbiddenException("Account banned");
    }
    if (user.status === "SUSPENDED") {
      throw new ForbiddenException("Account suspended");
    }
    if (user.status === "PENDING") {
      throw new ForbiddenException("Account pending activation");
    }

    const session = await this.startSession(user.id, ctx);
    const tokens = await this.issueTokens(user.id, user.type, session.id);
    await this.recordActivity(user.id, "auth.login", ctx, {
      sessionId: session.id,
    });
    return tokens;
  }

  async loginWithFirebase(
    dto: FirebaseLoginDto,
    ctx: SessionContext = {},
  ): Promise<Tokens> {
    const decoded = await this.firebase.verifyIdToken(dto.idToken);
    const firebaseUid = decoded.uid;
    const email = decoded.email ?? undefined;
    const emailVerified = decoded.email_verified === true;
    const verifiedPhone = decoded.phone_number ?? undefined;
    const phone = verifiedPhone ?? dto.phone ?? undefined;
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
      if (user.status === "BANNED") {
        throw new ForbiddenException("Account banned");
      }
      if (user.status === "SUSPENDED") {
        throw new ForbiddenException("Account suspended");
      }
      if (user.status === "PENDING") {
        throw new ForbiddenException("Account pending activation");
      }
      if (!user.firebaseUid) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { firebaseUid },
        });
      }
    } else {
      const placeholderHash = await bcrypt.hash(`firebase:${firebaseUid}`, 10);
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

    const session = await this.startSession(user.id, ctx);
    const tokens = await this.issueTokens(user.id, user.type, session.id);
    await this.recordActivity(user.id, "auth.firebase_login", ctx, {
      role,
      sessionId: session.id,
    });
    return tokens;
  }

  async refresh(
    refreshToken: string,
    ctx: SessionContext = {},
  ): Promise<Tokens> {
    let payload: RefreshPayload;
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
      include: { session: true },
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
    if (stored.session?.revokedAt) {
      throw new UnauthorizedException("Session revoked");
    }

    const expectedDeviceKey = stored.session?.deviceKey ?? null;
    const providedDeviceKey = ctx.device?.deviceKey ?? null;
    if (
      expectedDeviceKey &&
      providedDeviceKey &&
      expectedDeviceKey !== providedDeviceKey
    ) {
      if (stored.sessionId) {
        await this.revokeSession(stored.sessionId, "DEVICE_MISMATCH");
      }
      await this.recordActivity(payload.sub, "security.refresh_device_mismatch", ctx, {
        expectedDeviceKey,
        providedDeviceKey,
        sessionId: stored.sessionId,
      });
      throw new UnauthorizedException("Device verification failed");
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true, lastUsedAt: new Date() },
    });

    const sessionId = stored.sessionId ?? (await this.startSession(payload.sub, ctx)).id;
    await this.touchSession(sessionId, ctx);
    const tokens = await this.issueTokens(payload.sub, payload.role, sessionId);
    await this.recordActivity(payload.sub, "auth.refresh", ctx, { sessionId });
    return tokens;
  }

  async logout(userId: string, sessionId?: string): Promise<{ ok: boolean }> {
    if (sessionId) {
      await this.revokeSession(sessionId, "LOGOUT");
      await this.recordActivity(userId, "auth.logout", {}, { sessionId });
      return { ok: true };
    }

    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, lastUsedAt: new Date() },
    });
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "LOGOUT_ALL" },
    });
    await this.recordActivity(userId, "auth.logout_all", {});
    return { ok: true };
  }

  async me(userId: string): Promise<{
    userId: string;
    role: string;
    user: AuthUserResponse;
    staffRole?: AuthRoleSummary;
    permissions: string[];
  }> {
    const auth = await this.loadAuthProfile(userId);
    if (!auth) throw new UnauthorizedException("User no longer exists");
    return {
      userId: auth.user.id,
      role: auth.user.type,
      user: auth.user,
      staffRole: auth.staffRole,
      permissions: auth.permissions,
    };
  }

  private async issueTokens(
    userId: string,
    role: string,
    sessionId: string,
  ): Promise<Tokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role, sid: sessionId },
      {
        secret: this.config.get<string>("jwt.accessSecret"),
        expiresIn: this.config.get<string>("jwt.accessTtl"),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, role, sid: sessionId },
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
        sessionId,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlToMs(refreshTtl)),
        lastUsedAt: new Date(),
      },
    });

    const auth = await this.loadAuthProfile(userId);
    if (!auth) throw new UnauthorizedException("User no longer exists");
    return {
      accessToken,
      refreshToken,
      userId,
      role,
      sessionId,
      user: auth.user,
      staffRole: auth.staffRole,
      permissions: auth.permissions,
    };
  }

  private async loadAuthProfile(
    userId: string,
  ): Promise<
    | {
        user: AuthUserResponse;
        staffRole?: AuthRoleSummary;
        permissions: string[];
      }
    | null
  > {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
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

    const permissions = (user.staffRole?.permissions ?? []).map(
      (item) => item.permission.key,
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        username: user.username ?? undefined,
        phone: user.phone,
        email: user.email ?? undefined,
        type: user.type,
        status: user.status,
      },
      staffRole: user.staffRole
        ? {
            id: user.staffRole.id,
            name: user.staffRole.name,
            permissions,
          }
        : undefined,
      permissions,
    };
  }

  private async startSession(userId: string, ctx: SessionContext) {
    return this.prisma.session.create({
      data: {
        userId,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        deviceKey: ctx.device?.deviceKey ?? null,
        installationId: ctx.device?.installationId ?? null,
        platform: ctx.device?.platform ?? null,
        deviceName: ctx.device?.deviceName ?? null,
        appVersion: ctx.device?.appVersion ?? null,
      },
    });
  }

  private async touchSession(sessionId: string, ctx: SessionContext): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: {
        lastSeenAt: new Date(),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        deviceKey: ctx.device?.deviceKey ?? undefined,
        installationId: ctx.device?.installationId ?? undefined,
        platform: ctx.device?.platform ?? undefined,
        deviceName: ctx.device?.deviceName ?? undefined,
        appVersion: ctx.device?.appVersion ?? undefined,
      },
    });
  }

  private async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { sessionId, revoked: false },
      data: { revoked: true, lastUsedAt: new Date() },
    });
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  private async recordActivity(
    userId: string | null,
    action: string,
    ctx: SessionContext,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          userId,
          action,
          ip: ctx.ip ?? null,
          meta: (meta ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch {
      // best-effort only
    }
  }
}
