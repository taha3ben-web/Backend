import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
@RequirePermissions("settings.manage")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  findAll(@Query("group") group?: string) {
    return this.settings.findAll(group);
  }

  @Get(":key")
  findOne(@Param("key") key: string) {
    return this.settings.findOne(key);
  }

  @Post()
  upsert(@Body() dto: UpsertSettingDto) {
    return this.settings.upsert(dto);
  }

  @Post("bulk")
  bulkUpsert(@Body() dto: BulkUpsertSettingsDto) {
    return this.settings.bulkUpsert(dto);
  }

  @Put(":key")
  updateValue(@Param("key") key: string, @Body() dto: UpdateSettingValueDto) {
    return this.settings.updateValue(key, dto);
  }

  @Delete(":key")
  remove(@Param("key") key: string) {
    return this.settings.remove(key);
  }
}

@Controller("public/config")
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=30, stale-while-revalidate=300")
  getConfig() {
    return this.settings.publicConfig();
  }
}
