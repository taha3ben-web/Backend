import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD } from "@nestjs/core";
import configuration from "./config/configuration";
import { PrismaModule } from "./prisma/prisma.module";
import { InfraModule } from "./common/infra/infra.module";
import { ObservabilityModule } from "./common/observability/observability.module";
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
import { MessageTemplatesModule } from "./modules/message-templates/message-templates.module";
import { ContentBlocksModule } from "./modules/content-blocks/content-blocks.module";
import { BackupsModule } from "./modules/backups/backups.module";
import { QueueInsightModule } from "./modules/queue-insight/queue-insight.module";
import { PaymentGatewayModule } from "./modules/payment-gateways/payment-gateway.module";
import { CouponsModule } from "./modules/coupons/coupons.module";
import { PromoCodesModule } from "./modules/promo-codes/promo-codes.module";
import { ReferralModule } from "./modules/referral/referral.module";
import { LoyaltyModule } from "./modules/loyalty/loyalty.module";
import { SubscriptionsModule } from "./modules/subscriptions/subscriptions.module";
import { KycModule } from "./modules/kyc/kyc.module";
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
import { AgentsModule } from "./modules/agents/agents.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { HealthController } from "./modules/health/health.controller";
import { FinancialModule } from "./modules/financial/financial.module";
import { CountryConfigModule } from "./modules/country-config/country-config.module";
import { RiskModule } from "./modules/risk/risk.module";
import { ApiMetaModule } from "./common/api/api-meta.module";
import { ScheduledTripsModule } from "./modules/scheduled-trips/scheduled-trips.module";
import { PayoutsModule } from "./modules/payouts/payouts.module";
import { GrowthModule } from "./modules/growth/growth.module";
import { CityScalingModule } from "./modules/city-scaling/city-scaling.module";
import { PoolingModule } from "./modules/pooling/pooling.module";
import { LegalModule } from "./modules/legal/legal.module";
import { GeoModule } from "./modules/geo/geo.module";
import { FeatureFlagsModule } from "./modules/settings/feature-flags.module";
import { BootstrapModule } from "./modules/bootstrap/bootstrap.module";
import { FareQuotesModule } from "./modules/fare-quotes/fare-quotes.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    ObservabilityModule,
    InfraModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    AuthModule,
    UsersModule,
    DriversModule,
    TripsModule,
    ScheduledTripsModule,
    DashboardModule,
    FinancialModule,
    CountryConfigModule,
    RiskModule,
    ApiMetaModule,
    PaymentsModule,
    PayoutsModule,
    MatchingModule,
    PoolingModule,
    NotificationsModule,
    MessageTemplatesModule,
    ContentBlocksModule,
    BackupsModule,
    QueueInsightModule,
    PaymentGatewayModule,
    CouponsModule,
    PromoCodesModule,
    ReferralModule,
    LoyaltyModule,
    SubscriptionsModule,
    KycModule,
    PricingAdminModule,
    SupportModule,
    ReportsModule,
    RbacModule,
    GrowthModule,
    CityScalingModule,
    SettingsModule,
    RealtimeModule,
    EmergencyModule,
    AppVersionsModule,
    LegalModule,
    GeoModule,
    FeatureFlagsModule,
    BootstrapModule,
    FareQuotesModule,
    SessionsModule,
    VehicleTypesModule,
    AdsModule,
    AgentsModule,
    AssetsModule,
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
