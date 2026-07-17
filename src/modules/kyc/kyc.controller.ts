import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IdentityVerificationStatus } from "@prisma/client";
import { KycService } from "./kyc.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { ReviewKycDto, SubmitKycDto } from "./dto/kyc.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("kyc")
export class KycController {
  constructor(private readonly kyc: KycService) {}

  /** حالة تحقق هوية المستخدم الحالي (الأحدث) إن وُجدت. */
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.kyc.getMySubmission(user.userId);
  }

  /** تقديم طلب تحقق هوية جديد. */
  @Post("submit")
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitKycDto) {
    return this.kyc.submit(user.userId, dto);
  }

  // ---------- إدارة (STAFF) ----------
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("kyc.manage")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("status") status?: IdentityVerificationStatus,
  ) {
    return this.kyc.adminList(q, status);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("kyc.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.kyc.getOrThrow(id);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("kyc.manage")
  @Post(":id/approve")
  approve(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewKycDto,
  ) {
    return this.kyc.approve(id, user.userId, dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("kyc.manage")
  @Post(":id/reject")
  reject(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewKycDto,
  ) {
    return this.kyc.reject(id, user.userId, dto);
  }
}
