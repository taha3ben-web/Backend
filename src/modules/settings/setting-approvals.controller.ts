import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SettingChangeRequestStatus } from "@prisma/client";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ReviewSettingChangeDto } from "./dto/setting-approval.dto";
import { SettingsService } from "./settings.service";

@Controller("setting-change-requests")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("settings.manage")
export class SettingApprovalsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  findAll(@Query("status") status?: SettingChangeRequestStatus) {
    return this.settings.listChangeRequests(status);
  }

  @Post(":id/approve")
  approve(
    @Param("id") id: string,
    @Body() dto: ReviewSettingChangeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.approveChangeRequest(id, user.userId, dto.note);
  }

  @Post(":id/reject")
  reject(
    @Param("id") id: string,
    @Body() dto: ReviewSettingChangeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.rejectChangeRequest(id, user.userId, dto.note);
  }
}
