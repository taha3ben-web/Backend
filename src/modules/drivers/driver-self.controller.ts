import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Param,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { DriverSelfService } from "./driver-self.service";
import {
  AddDocumentDto,
  SetAvailabilityDto,
  UpdateDriverProfileDto,
  UploadUrlDto,
} from "./dto/driver-self.dto";

/**
 * واجهة الخدمة الذاتية للسائق ("/api/driver/*").
 * محمية بـ JWT + دور DRIVER، ومنفصلة عن "/api/drivers" الخاصة بالطاقم (STAFF).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("DRIVER")
@Controller("driver")
export class DriverSelfController {
  constructor(private readonly service: DriverSelfService) {}

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.service.getProfile(user.userId);
  }

  @Patch("me")
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateDriverProfileDto) {
    return this.service.updateProfile(user.userId, dto);
  }

  @Post("me/availability")
  availability(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.service.setAvailability(user.userId, dto);
  }

  /**
   * صدارة السائقين: scope=city (الافتراضي) أو scope=country.
   * مطلوبة لشاشة الطبقات والترقية في تطبيق السائق.
   */
  @Get("leaderboard")
  leaderboard(
    @CurrentUser() user: AuthUser,
    @Query("scope") scope?: string,
    @Query("limit") limit?: string,
  ) {
    return this.service.leaderboard(
      user.userId,
      scope,
      limit ? Number(limit) : undefined,
    );
  }

  /**
   * المرحلة د — شاشة الطبقات: السلّم والعتبات والمزايا من الخادم.
   * الترتيب لا يُعاد هنا: "/driver/leaderboard" يُرجع me.rank أصلًا.
   */
  @Get("me/tier")
  tier(@CurrentUser() user: AuthUser) {
    return this.service.tier(user.userId);
  }

  /**
   * المرحلة و — أهلية السائق لنوع مركبة قبل اختياره.
   * نفس الخدمة التي تستعملها اللوحة، لكن محصورة بملف السائق نفسه:
   * معرف السائق يُشتق من التوكن ولا يأتي من المسار، فلا يمكن فحص سائق آخر.
   */
  @Get("me/vehicle-types/:vehicleTypeId/eligibility")
  vehicleTypeEligibility(
    @CurrentUser() user: AuthUser,
    @Param("vehicleTypeId") vehicleTypeId: string,
  ) {
    return this.service.vehicleTypeEligibility(user.userId, vehicleTypeId);
  }

  @Get("me/earnings")
  earnings(@CurrentUser() user: AuthUser) {
    return this.service.earnings(user.userId);
  }

  @Get("me/sanctions")
  sanctions(@CurrentUser() user: AuthUser) {
    return this.service.sanctionStatus(user.userId);
  }

  @Get("me/trips")
  trips(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.service.trips(user.userId, q);
  }


  @Get("me/trips/:id")
  trip(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.service.trip(user.userId, id); }

  @Patch("me/trips/:id/status")
  updateTrip(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: { status: "ARRIVING" | "IN_PROGRESS" | "COMPLETED"; reason?: string }) { return this.service.updateTripStatus(user.userId, id, body.status, body.reason); }

  @Post("me/documents")
  addDocument(@CurrentUser() user: AuthUser, @Body() dto: AddDocumentDto) {
    return this.service.addDocument(user.userId, dto);
  }

  @Post("me/upload-url")
  uploadUrl(@CurrentUser() user: AuthUser, @Body() dto: UploadUrlDto) {
    return this.service.createUploadUrl(user.userId, dto);
  }
}
