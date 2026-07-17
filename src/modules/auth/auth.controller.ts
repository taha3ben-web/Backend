import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { FirebaseLoginDto } from "./dto/firebase-login.dto";
import { RequestOtpDto, VerifyOtpDto } from "./dto/otp.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { AUTH_RATE_LIMITS } from "./auth-rate-limits";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(AUTH_RATE_LIMITS.register)
  @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, this.extractSessionContext(req));
  }

  @Throttle(AUTH_RATE_LIMITS.login)
  @Post("login")
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.extractSessionContext(req));
  }

  @Throttle(AUTH_RATE_LIMITS.firebase)
  @Post("firebase")
  firebase(@Body() dto: FirebaseLoginDto, @Req() req: Request) {
    return this.auth.loginWithFirebase(dto, this.extractSessionContext(req));
  }

  @Throttle(AUTH_RATE_LIMITS.refresh)
  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Throttle(AUTH_RATE_LIMITS.otpRequest)
  @Post("otp/request")
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestPhoneOtp(dto);
  }

  @Throttle(AUTH_RATE_LIMITS.otpVerify)
  @Post("otp/verify")
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyPhoneOtp(dto);
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
