import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser, AuthUser } from "../../common/decorators/current-user.decorator";
import { BootstrapService } from "./bootstrap.service";
import { BootstrapContextDto } from "./dto/bootstrap.dto";

/**
 * نقطة التهيئة الموحّدة للتطبيق (مُصادَق عليه).
 * استدعاء واحد يرجع كل إعدادات الإقلاع.
 */
@Controller("bootstrap")
@UseGuards(JwtAuthGuard)
export class BootstrapController {
  constructor(private readonly bootstrap: BootstrapService) {}

  @Get()
  build(@CurrentUser() user: AuthUser, @Query() query: BootstrapContextDto) {
    return this.bootstrap.build(
      { userId: user.userId, role: user.role },
      query,
    );
  }
}
