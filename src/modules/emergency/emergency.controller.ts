import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { EmergencyService } from "./emergency.service";
import {
  CreateEmergencyContactDto,
  UpdateEmergencyContactDto,
} from "./dto/emergency.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("emergency-contacts")
export class EmergencyController {
  constructor(private readonly emergency: EmergencyService) {}

  /** جهات طوارئ المستخدم الحالي */
  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.emergency.list(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEmergencyContactDto,
  ) {
    return this.emergency.create(user.userId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateEmergencyContactDto,
  ) {
    return this.emergency.update(user.userId, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.emergency.remove(user.userId, id);
  }

  // ---------- إدارة (STAFF) ----------

  /** جهات طوارئ مستخدم معيّن (للدعم/الأمان) */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get("user/:userId")
  forUser(@Param("userId") userId: string) {
    return this.emergency.listForUser(userId);
  }
}
