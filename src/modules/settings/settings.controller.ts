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
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { AppVersionsService } from "../app-versions/app-versions.service";
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

  @Get("governance/overview")
  governanceOverview(@Query("limit") limit?: string) {
    return this.settings.governanceOverview(limit ? Number(limit) : 20);
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

  @Post(":key/publish")
  publish(@Param("key") key: string, @CurrentUser() user: AuthUser) {
    return this.settings.publish(key, user.userId);
  }

  @Post(":key/discard-draft")
  discardDraft(@Param("key") key: string) {
    return this.settings.discardDraft(key);
  }

  @Get(":key/revisions")
  revisions(
    @Param("key") key: string,
    @Query("page") page = "1",
    @Query("limit") limit = "20",
  ) {
    return this.settings.listRevisions(
      key,
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(limit) || 20)),
    );
  }

  @Post(":key/rollback/:publishedVersion")
  rollback(
    @Param("key") key: string,
    @Param("publishedVersion") publishedVersion: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.rollbackToPublishedVersion(
      key,
      Number(publishedVersion),
      user.userId,
    );
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
  constructor(
    private readonly settings: SettingsService,
    private readonly appVersions: AppVersionsService,
  ) {}

  @Get()
  @Header("Cache-Control", "public, max-age=30, stale-while-revalidate=300")
  async getConfig(
    @Query("platform") platform?: string,
    @Query("version") version?: string,
    @Query("appId") appId?: string,
    @Query("clientOs") clientOs?: string,
    @Query("countryCode") countryCode?: string,
    @Query("releaseChannel") releaseChannel?: string,
    @Query("subjectId") subjectId?: string,
  ) {
    const config = await this.settings.publicConfig();
    const appVersionPolicy =
      platform && version
        ? await this.appVersions.check({
            platform,
            version,
            appId,
            clientOs,
            countryCode,
            releaseChannel,
            subjectId,
          })
        : null;

    return {
      ...(config as Record<string, unknown>),
      appVersionPolicy,
    };
  }
}
