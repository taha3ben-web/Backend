import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { TransactionalEmailModule } from "../notifications/transactional-email.module";
import { InvoicesService } from "./invoices.service";
import { InvoicesController } from "./invoices.controller";

/**
 * فواتير الرحلات (PDF).
 * StorageService معرّف في وحدة عامّة (@Global) فلا حاجة لاستيراده هنا.
 */
@Module({
  imports: [PrismaModule, TransactionalEmailModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
