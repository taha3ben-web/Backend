import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { MatchingService } from "./matching.service";
import { PricingService } from "./pricing.service";
import { RequestRideDto, QuoteDto } from "./dto/matching.dto";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("rides")
export class MatchingController {
  constructor(
    private readonly matching: MatchingService,
    private readonly pricing: PricingService,
  ) {}

  /** تقدير الأجرة قبل الطلب */
  @Post("quote")
  quote(@Body() dto: QuoteDto) {
    return this.pricing.quote(
      dto.pickupLat,
      dto.pickupLng,
      dto.destLat,
      dto.destLng,
      {
        rideClass: dto.rideClass ?? "ECONOMY",
        cityId: dto.cityId,
        vehicleTypeId: dto.vehicleTypeId,
      },
    );
  }

  /** الراكب يطلب رحلة (يبدأ البحث عن سائق) */
  @Post("request")
  request(@CurrentUser() user: AuthUser, @Body() dto: RequestRideDto) {
    return this.matching.requestRide(user.userId, dto);
  }

  /** الراكب يلغي البحث */
  @Patch(":id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.matching.cancelSearch(id, user.userId);
  }

  /** سجل رحلات الراكب (رحلاتي) */
  @Get("mine")
  myTrips(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.matching.passengerTrips(user.userId, q);
  }

  /** تفاصيل رحلة يملكها الراكب */
  @Get(":id")
  getOne(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.matching.getTripForUser(id, user.userId);
  }
}
