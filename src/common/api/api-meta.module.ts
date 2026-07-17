import { Module } from "@nestjs/common";
import { ApiMetaController } from "./api-meta.controller";

/** وحدة وصف API العامّة (إصدار + لغات + فهرس أكواد الأخطاء) للموبايل. */
@Module({
  controllers: [ApiMetaController],
})
export class ApiMetaModule {}
