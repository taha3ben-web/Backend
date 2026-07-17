import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PromoCodesService } from "./promo-codes.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  CreatePromoCodeDto,
  RedeemPromoCodeDto,
  UpdatePromoCodeDto,
} from "./dto/promo-codes.dto";
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
@Controller("promo-codes")
export class PromoCodesController {
  constructor(private readonly promos: PromoCodesService) {}

  /** المستخدم يستبدل رمزًا ترويجيًا فيُضاف الرصيد إلى محفظته. */
  @Post("redeem")
  redeem(@CurrentUser() user: AuthUser, @Body() dto: RedeemPromoCodeDto) {
    return this.promos.redeem(user.userId, dto.code);
  }

  // ---------- إدارة (STAFF) ----------

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("promoCodes.manage")
  @Post()
  create(@Body() dto: CreatePromoCodeDto) {
    return this.promos.create(dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("promoCodes.manage")
  @Get()
  findAll(@Query() q: PaginationDto) {
    return this.promos.findAll(q);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("promoCodes.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.promos.findOne(id);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("promoCodes.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdatePromoCodeDto) {
    return this.promos.update(id, dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("promoCodes.manage")
  @Delete(":id")
  deactivate(@Param("id") id: string) {
    return this.promos.deactivate(id);
  }
}
