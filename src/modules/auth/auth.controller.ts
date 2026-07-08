import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { SessionsService } from "../sessions/sessions.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post("register")
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const tokens = await this.auth.register(dto);
    await this.recordSession(tokens.userId, req);
    return tokens;
  }

  @Post("login")
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const tokens = await this.auth.login(dto);
    await this.recordSession(tokens.userId, req);
    return tokens;
  }

  // جسر الهوية: تبادل رمز Firebase ID بجلسة JWT خاصة بالخادم.
  @Post("firebase")
  async firebase(@Body() dto: FirebaseLoginDto, @Req() req: Request) {
    const tokens = await this.auth.loginWithFirebase(dto);
    await this.recordSession(tokens.userId, req);
    return tokens;
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.userId);
  }

  /** تسجيل جلسة مع IP و User-Agent (دون إيقاف الدخول إن فشلت). */
  private async recordSession(userId: string, req: Request) {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      null;
    const userAgent = (req.headers["user-agent"] as string) ?? null;
    await this.sessions.record(userId, ip, userAgent);
  }
}
