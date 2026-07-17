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
import { AdPlacement } from "@prisma/client";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { AdsService } from "./ads.service";
import { CreateAdDto, UpdateAdDto } from "./dto/ad.dto";

@Controller("ads")
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get("active")
  @UseGuards(JwtAuthGuard)
  active(
    @Query("placement") placement: AdPlacement,
    @Query("appId") appId?: string,
    @Query("clientOs") clientOs?: string,
    @Query("countryCode") countryCode?: string,
    @Query("segments") segments?: string,
  ) {
    return this.ads.findActive(placement ?? "PASSENGER_HOME", {
      appId,
      clientOs,
      countryCode,
      segments: segments
        ? segments
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
    });
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  findAll(
    @Query("placement") placement?: AdPlacement,
    @Query("campaignKey") campaignKey?: string,
  ) {
    return this.ads.findAll(placement, campaignKey);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  create(@Body() dto: CreateAdDto) {
    return this.ads.create(dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  update(@Param("id") id: string, @Body() dto: UpdateAdDto) {
    return this.ads.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  remove(@Param("id") id: string) {
    return this.ads.remove(id);
  }
}
