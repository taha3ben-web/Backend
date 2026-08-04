import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { FirebaseAdminService } from "./firebase-admin.service";
import { LoginThrottleService } from "./login-throttle.service";
import { OtpService } from "./otp.service";
import { SmsProvider } from "../notifications/providers/sms.provider";
import { CountryConfigModule } from "../country-config/country-config.module";

@Module({
  imports: [PassportModule, JwtModule.register({}), CountryConfigModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    FirebaseAdminService,
    LoginThrottleService,
    OtpService,
    // SmsProvider يعتمد على ConfigService فقط؛ نسجّله هنا لتجنّب استيراد
    // NotificationsModule (الذي يستورد AuthModule ويُنتج تبعية دائرية).
    SmsProvider,
  ],
  exports: [AuthService, FirebaseAdminService],
})
export class AuthModule {}
