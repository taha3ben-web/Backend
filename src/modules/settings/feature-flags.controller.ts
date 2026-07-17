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
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CreateFeatureFlagDto,
  PreviewFeatureFlagsDto,
  UpdateFeatureFlagControlDto,
  UpdateFeatureFlagDto,
} from "./dto/feature-flags.dto";
import { FeatureFlagsService } from "./feature-flags.service";

@Controller("feature-flags")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("settings.manage")
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  findAll(@Query("search") search?: string) {
    return this.flags.findAll(search);
  }

  @Get("control")
  getControl() {
    return this.flags.getControl();
  }

  @Get("health")
  health() {
    return this.flags.health();
  }

  @Patch("control")
  updateControl(@Body() dto: UpdateFeatureFlagControlDto) {
    return this.flags.updateControl(dto);
  }

  @Post("preview")
  preview(@Body() dto: PreviewFeatureFlagsDto) {
    return this.flags.evaluate(dto);
  }

  @Post()
  create(@Body() dto: CreateFeatureFlagDto) {
    return this.flags.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateFeatureFlagDto) {
    return this.flags.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.flags.remove(id);
  }
}
