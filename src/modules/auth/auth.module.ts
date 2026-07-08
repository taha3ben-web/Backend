import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { FirebaseAdminService } from "./firebase-admin.service";
import { SessionsModule } from "../sessions/sessions.module";

@Module({
  imports: [PassportModule, JwtModule.register({}), SessionsModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, FirebaseAdminService],
  exports: [AuthService, FirebaseAdminService],
})
export class AuthModule {}
