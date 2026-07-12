import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService, SessionContext } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";
import { DeviceContextDto } from "./dto/device-context.dto";
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
    return this.auth.register(dto, this.sessionContext(req, dto.device));
  }

  @Post("login")
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.sessionContext(req, dto.device));
  }

  @Post("firebase")
  firebase(@Body() dto: FirebaseLoginDto, @Req() req: Request) {
    return this.auth.loginWithFirebase(dto, this.sessionContext(req, dto.device));
  }

  @Post("refresh")
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.sessionContext(req, dto.device));
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.userId, user.sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  private sessionContext(
    req: Request,
    device?: DeviceContextDto,
  ): SessionContext {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)
        ?.split(",")[0]
        ?.trim() || req.ip || null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
    return { ip, userAgent, device };
  }
}
