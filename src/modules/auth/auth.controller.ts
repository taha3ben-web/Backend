import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
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
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, this.extractSessionContext(req));
  }

  @Post("login")
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.extractSessionContext(req));
  }

  @Post("firebase")
  firebase(@Body() dto: FirebaseLoginDto, @Req() req: Request) {
    return this.auth.loginWithFirebase(dto, this.extractSessionContext(req));
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.userId, user.sessionId);
  }

  private extractSessionContext(req: Request) {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      null;
    const userAgent = (req.headers["user-agent"] as string) ?? null;
    return { ip, userAgent };
  }
}
