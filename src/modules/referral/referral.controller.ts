import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ReferralService } from "./referral.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { ApplyReferralDto } from "./dto/referral.dto";
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
@Controller("referrals")
export class ReferralController {
  constructor(private readonly referrals: ReferralService) {}

  /** رمز الإحالة الخاص بالمستخدم (يُولّد عند أول طلب). */
  @Get("my-code")
  myCode(@CurrentUser() user: AuthUser) {
    return this.referrals.getOrCreateMyCode(user.userId);
  }

  /** إحالات المستخدم الحالي. */
  @Get("mine")
  mine(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.referrals.myReferrals(user.userId, q);
  }

  /** المستخدم يدخل رمز إحالة لربط حسابه. */
  @Post("apply")
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplyReferralDto) {
    return this.referrals.applyReferral(user.userId, dto.code);
  }

  // ---------- إدارة (STAFF) ----------

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("referrals.manage")
  @Get()
  findAll(@Query() q: PaginationDto) {
    return this.referrals.findAll(q);
  }

  /** تأهيل إحالة مُحال ومنح المكافآت (idempotent). نقطة التكامل المستقبلية مع إكمال الرحلة. */
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("referrals.manage")
  @Post(":refereeId/qualify")
  qualify(@Param("refereeId") refereeId: string) {
    return this.referrals.qualifyReferral(refereeId);
  }
}
