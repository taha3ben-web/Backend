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
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("PASSENGER")
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

  /**
   * D-7 — ما سيحدث لو ألغى الراكب الآن (قرار الخادم، بلا أي مبلغ مالي).
   * يُستدعى من PassengerApp قبل عرض نافذة تأكيد الإلغاء.
   */
  @Get(":id/cancel-preview")
  cancelPreview(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.matching.cancelPreview(user.userId, id);
  }

  /** الراكب يلغي البحث */
  @Patch(":id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.matching.passengerCancel(user.userId, id);
  }

  /**
   * المرحلة ب: أنواع المركبات المتوفرة فعلًا حول الراكب.
   * يُستدعى قبل عرض قائمة الأنواع، فلا يُعرض نوع لا وجود له في المنطقة.
   * مثال: /api/rides/availability?lat=36.75&lng=3.06&radiusKm=5
   */
  @Get("availability")
  availability(
    @Query("lat") lat: string,
    @Query("lng") lng: string,
    @Query("radiusKm") radiusKm?: string,
  ) {
    return this.matching.availability(
      Number(lat),
      Number(lng),
      radiusKm ? Number(radiusKm) : undefined,
    );
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
