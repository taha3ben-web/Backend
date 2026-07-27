import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsUUID } from "class-validator";
import { CallMaskingService } from "./call-masking.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../../common/decorators/current-user.decorator";

export class ConnectCallDto {
  @IsUUID()
  tripId!: string;
}

/**
 * قناة الاتصال بين الراكب والسائق دون كشف الأرقام.
 * لا يُرجع أي رقم حقيقي في أي حالة.
 */
@UseGuards(JwtAuthGuard)
@Controller("calls")
export class CallMaskingController {
  constructor(private readonly calls: CallMaskingService) {}

  /** وضع الاتصال الحالي (ليعرف التطبيق أي زر يعرض). */
  @Get("mode")
  mode() {
    const adapter = this.calls.activeAdapter();
    const mode =
      adapter.name === "chat_only"
        ? "CHAT_ONLY"
        : adapter.name === "direct"
          ? "DIRECT_NUMBER"
          : "MASKED_NUMBER";
    return { provider: adapter.name, mode };
  }

  /** يفتح قناة اتصال لرحلة قائمة. */
  @Post("connect")
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectCallDto) {
    return this.calls.connect(user.userId, dto.tripId);
  }
}
