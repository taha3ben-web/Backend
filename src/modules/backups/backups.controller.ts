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
import { BackupsService } from "./backups.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import {
  ApplyRetentionDto,
  CreateBackupDto,
  DrStatusQueryDto,
  QueryBackupsDto,
  UpdateBackupDto,
} from "./dto/backup.dto";

@Controller("backups")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("settings.manage")
export class BackupsController {
  constructor(private readonly service: BackupsService) {}

  @Get()
  list(@Query() query: QueryBackupsDto) {
    return this.service.list(query);
  }

  @Get("dr-status")
  drStatus(@Query() query: DrStatusQueryDto) {
    return this.service.drStatus(query);
  }

  @Post("retention/apply")
  applyRetention(@Body() dto: ApplyRetentionDto) {
    return this.service.applyRetention(dto);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBackupDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateBackupDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
