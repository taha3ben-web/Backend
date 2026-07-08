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
import { Roles } from "../../common/decorators/roles.decorator";
import { AdsService } from "./ads.service";
import { CreateAdDto, UpdateAdDto } from "./dto/ad.dto";

@Controller("ads")
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  /** الإعلانات النشطة لموضع معيّن (متاح لأي مستخدم مُصادَق — للتطبيقات). */
  @Get("active")
  @UseGuards(JwtAuthGuard)
  active(@Query("placement") placement: AdPlacement) {
    return this.ads.findActive(placement ?? "PASSENGER_HOME");
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  findAll(@Query("placement") placement?: AdPlacement) {
    return this.ads.findAll(placement);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  create(@Body() dto: CreateAdDto) {
    return this.ads.create(dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  update(@Param("id") id: string, @Body() dto: UpdateAdDto) {
    return this.ads.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  remove(@Param("id") id: string) {
    return this.ads.remove(id);
  }
}
