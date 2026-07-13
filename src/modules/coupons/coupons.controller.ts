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
import { CouponsService } from "./coupons.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  CreateCouponDto,
  UpdateCouponDto,
  ValidateCouponDto,
} from "./dto/coupons.dto";
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
@Controller("coupons")
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  /** الراكب يتحقق من كوبون ويرى الخصم قبل الطلب */
  @Post("validate")
  validate(@CurrentUser() user: AuthUser, @Body() dto: ValidateCouponDto) {
    return this.coupons.validateAndCompute(dto.code, user.userId, dto.fare);
  }

  // ---------- إدارة (STAFF) ----------

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("coupons.manage")
  @Post()
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("coupons.manage")
  @Get()
  findAll(@Query() q: PaginationDto) {
    return this.coupons.findAll(q);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("coupons.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.coupons.findOne(id);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("coupons.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(id, dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("coupons.manage")
  @Delete(":id")
  deactivate(@Param("id") id: string) {
    return this.coupons.deactivate(id);
  }
}
