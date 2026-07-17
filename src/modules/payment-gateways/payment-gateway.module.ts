import { Module } from "@nestjs/common";
import { PaymentGatewayController } from "./payment-gateway.controller";
import { PaymentGatewayService } from "./payment-gateway.service";

/**
 * وحدة سجلّ مزوّدي الدفع (PSP) ورصد صحّة الـ webhooks. تعتمد على
 * PrismaService (عالمي) فقط — طبقة رؤية مستقلّة لا تمسّ وحدة الدفع القائمة.
 */
@Module({
  controllers: [PaymentGatewayController],
  providers: [PaymentGatewayService],
})
export class PaymentGatewayModule {}
