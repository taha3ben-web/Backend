import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { LostItemStatus } from "@prisma/client";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { LostItemsService } from "./lost-items.service";
import {
  CreateLostItemDto,
  UpdateLostItemStatusDto,
} from "./dto/lost-item.dto";

@UseGuards(JwtAuthGuard)
@Controller("lost-items")
export class LostItemsController {
  constructor(private readonly lostItems: LostItemsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLostItemDto) {
    return this.lostItems.create(user.userId, dto);
  }

  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.lostItems.mine(user.userId);
  }

  @Get("driver")
  forDriver(@CurrentUser() user: AuthUser) {
    return this.lostItems.forDriver(user.userId);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("support.manage")
  @Get()
  list(@Query() q: PaginationDto, @Query("status") status?: LostItemStatus) {
    return this.lostItems.list(q, status);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("support.manage")
  @Patch(":id/status")
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateLostItemStatusDto,
  ) {
    return this.lostItems.updateStatus(user.userId, id, dto);
  }
}
