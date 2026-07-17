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
import { ContentBlocksService } from "./content-blocks.service";
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
  CreateContentBlockDto,
  PublicContentQueryDto,
  QueryContentBlocksDto,
  UpdateContentBlockDto,
} from "./dto/content-block.dto";

@Controller("content-blocks")
export class ContentBlocksController {
  constructor(private readonly service: ContentBlocksService) {}

  /** قراءة عامة للمحتوى الحيّ (لأي مستخدم مُصادَق عليه). */
  @Get("live")
  @UseGuards(JwtAuthGuard)
  live(@Query() query: PublicContentQueryDto) {
    return this.service.listPublic(query);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  list(@Query() query: QueryContentBlocksDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  create(
    @Body() dto: CreateContentBlockDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateContentBlockDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
