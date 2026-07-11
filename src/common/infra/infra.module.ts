import { Global, Module } from "@nestjs/common";
import { EventBusService } from "./event-bus.service";
import { CatalogCacheService } from "./catalog-cache.service";

/**
 * بنية تحتية مشتركة (عامة): ناقل الأحداث + ذاكرة تخزين الكتالوج.
 * متاحة لكل الوحدات دون إعادة استيراد.
 */
@Global()
@Module({
  providers: [EventBusService, CatalogCacheService],
  exports: [EventBusService, CatalogCacheService],
})
export class InfraModule {}
