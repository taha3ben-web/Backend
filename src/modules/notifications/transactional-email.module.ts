import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { EmailProvider } from "./providers/email.provider";
import { TransactionalEmailService } from "./transactional-email.service";

/**
 * وحدة خفيفة للبريد المعاملاتي فقط.
 *
 * لماذا ليست `NotificationsModule`: تلك الوحدة تستورد Realtime و Auth،
 * واستيرادها من الفواتير أو الرحلات يصنع دورة تبعية
 * (Invoices → Notifications → Realtime → Trips → Invoices). هذه الوحدة لا تحمل
 * إلا Prisma ومزوّد البريد، فيمكن استيرادها من أي مكان بلا خطر.
 */
@Module({
  imports: [PrismaModule],
  providers: [EmailProvider, TransactionalEmailService],
  exports: [TransactionalEmailService],
})
export class TransactionalEmailModule {}
