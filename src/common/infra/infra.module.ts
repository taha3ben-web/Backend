import { Global, Module } from "@nestjs/common";
import { EventBusService } from "./event-bus.service";
import { CatalogCacheService } from "./catalog-cache.service";
import { OutboxService } from "./outbox.service";
import { DistributedLockService } from "./distributed-lock.service";
import { ConfigCacheService } from "./config-cache.service";

/**
 * بنية تحتية مشتركة (عامة): ناقل الأحداث + صندوق الصادر الدائم +
 * القفل الموزّع + ذاكرة تخزين الكتالوج. متاحة لكل الوحدات دون إعادة استيراد.
 */
@Global()
@Module({
  providers: [
    EventBusService,
    CatalogCacheService,
    OutboxService,
    DistributedLockService,
    ConfigCacheService,
  ],
  exports: [
    EventBusService,
    CatalogCacheService,
    OutboxService,
    DistributedLockService,
    ConfigCacheService,
  ],
})
export class InfraModule {}
