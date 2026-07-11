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
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { ListQueryDto } from "../../common/dto/list-query.dto";
import { FeaturesService } from "./features.service";
import { CreateFeatureDto, UpdateFeatureDto } from "./dto/feature.dto";

@Controller("features")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  findAll(@Query() query: ListQueryDto) {
    return this.features.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.features.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFeatureDto, @CurrentUser() user: AuthUser) {
    return this.features.create(dto, user?.userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFeatureDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.features.update(id, dto, user?.userId);
  }

  @Patch(":id/active")
  setActive(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.features.setActive(id, isActive, user?.userId);
  }

  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.features.restore(id, user?.userId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.features.remove(id, user?.userId);
  }
}
