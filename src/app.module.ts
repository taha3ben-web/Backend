import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD } from "@nestjs/core";
import configuration from "./config/configuration";
import { PrismaModule } from "./prisma/prisma.module";
import { InfraModule } from "./common/infra/infra.module";
import { RedisModule } from "./modules/redis/redis.module";
import { StorageModule } from "./modules/storage/storage.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { DriversModule } from "./modules/drivers/drivers.module";
import { TripsModule } from "./modules/trips/trips.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { MatchingModule } from "./modules/matching/matching.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { CouponsModule } from "./modules/coupons/coupons.module";
import { PricingAdminModule } from "./modules/pricing/pricing-admin.module";
import { SupportModule } from "./modules/support/support.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { RbacModule } from "./modules/rbac/rbac.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { EmergencyModule } from "./modules/emergency/emergency.module";
import { AppVersionsModule } from "./modules/app-versions/app-versions.module";
import { SessionsModule } from "./modules/sessions/sessions.module";
import { VehicleTypesModule } from "./modules/vehicle-types/vehicle-types.module";
import { AdsModule } from "./modules/ads/ads.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { HealthController } from "./modules/health/health.controller";
import { FinancialModule } from "./modules/financial/financial.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    InfraModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    AuthModule,
    UsersModule,
    DriversModule,
    TripsModule,
    DashboardModule,
    FinancialModule,
    PaymentsModule,
    MatchingModule,
    NotificationsModule,
    CouponsModule,
    PricingAdminModule,
    SupportModule,
    ReportsModule,
    RbacModule,
    SettingsModule,
    RealtimeModule,
    EmergencyModule,
    AppVersionsModule,
    SessionsModule,
    VehicleTypesModule,
    AdsModule,
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
