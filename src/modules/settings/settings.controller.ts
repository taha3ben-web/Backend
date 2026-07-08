import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { SettingsService } from "./settings.service";
import {
  BulkUpsertSettingsDto,
  UpdateSettingValueDto,
  UpsertSettingDto,
} from "./dto/settings.dto";

@Controller("settings")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions("settings.manage")
  findAll(@Query("group") group?: string) {
    return this.settings.findAll(group);
  }

  @Get(":key")
  @RequirePermissions("settings.manage")
  findOne(@Param("key") key: string) {
    return this.settings.findOne(key);
  }

  @Post()
  @RequirePermissions("settings.manage")
  upsert(@Body() dto: UpsertSettingDto) {
    return this.settings.upsert(dto);
  }

  @Post("bulk")
  @RequirePermissions("settings.manage")
  bulkUpsert(@Body() dto: BulkUpsertSettingsDto) {
    return this.settings.bulkUpsert(dto);
  }

  @Put(":key")
  @RequirePermissions("settings.manage")
  updateValue(@Param("key") key: string, @Body() dto: UpdateSettingValueDto) {
    return this.settings.updateValue(key, dto);
  }

  @Delete(":key")
  @RequirePermissions("settings.manage")
  remove(@Param("key") key: string) {
    return this.settings.remove(key);
  }
}
