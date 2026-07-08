import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { RatingsService } from "./ratings.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CreateRatingDto } from "./dto/support.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("ratings")
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  /** قائمة إدارية بكل التقييمات (STAFF فقط) */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("STAFF")
  adminList(@Query() q: PaginationDto, @Query("stars") stars?: string) {
    return this.ratings.adminList(q, stars ? Number(stars) : undefined);
  }

  /** تقييم الرحلة (الطرف الآخر تلقائيًا) */
  @Post()
  rate(@CurrentUser() user: AuthUser, @Body() dto: CreateRatingDto) {
    return this.ratings.rateTrip(user.userId, dto);
  }

  /** تقييمات مستخدم معيّن (مع المتوسط) */
  @Get("user/:userId")
  forUser(@Param("userId") userId: string, @Query() q: PaginationDto) {
    return this.ratings.forUser(userId, q);
  }
}
