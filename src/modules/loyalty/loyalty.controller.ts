import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { LoyaltyService } from "./loyalty.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { AdjustLoyaltyDto, RedeemLoyaltyDto } from "./dto/loyalty.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("loyalty")
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  /** رصيد وفئة المستخدم الحالي. */
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.loyalty.getBalance(user.userId);
  }

  /** سجل حركات نقاط المستخدم. */
  @Get("me/history")
  history(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.loyalty.history(user.userId, q);
  }

  /** استبدال النقاط برصيد محفظة. */
  @Post("redeem")
  redeem(@CurrentUser() user: AuthUser, @Body() dto: RedeemLoyaltyDto) {
    return this.loyalty.redeem(user.userId, dto.points);
  }

  // ---------- إدارة (STAFF) ----------

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("loyalty.manage")
  @Get()
  findAll(@Query() q: PaginationDto) {
    return this.loyalty.findAll(q);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("loyalty.manage")
  @Post(":userId/adjust")
  adjust(@Param("userId") userId: string, @Body() dto: AdjustLoyaltyDto) {
    return this.loyalty.adjust(userId, dto.points, dto.reason);
  }
}
