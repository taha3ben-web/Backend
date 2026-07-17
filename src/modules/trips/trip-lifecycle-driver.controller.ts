import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { TripsService } from "./trips.service";

/**
 * واجهة السائق لإدارة دورة حياة الرحلة ("/api/driver/trips").
 * محمية بـ JWT + دور DRIVER. تعرض عبر REST نفس انتقالات الحالة التي
 * كانت متاحة سابقًا عبر WebSocket فقط. كل التحقّق (الملكية + آلة الحالات)
 * والتسوية المالية عند الإتمام وإشعارات Push للراكب تتم داخل
 * TripsService.driverChangeStatus (مصدر الحقيقة الوحيد).
 */
@Controller("driver/trips")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("DRIVER")
export class TripLifecycleDriverController {
  constructor(private readonly trips: TripsService) {}

  /** وصل السائق إلى نقطة الانطلاق (ACCEPTED -> ARRIVING). */
  @Post(":id/arriving")
  arriving(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.trips.driverChangeStatus(user.userId, id, "ARRIVING");
  }

  /** بدء الرحلة (ARRIVING -> IN_PROGRESS). */
  @Post(":id/start")
  start(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.trips.driverChangeStatus(user.userId, id, "IN_PROGRESS");
  }

  /** إتمام الرحلة (IN_PROGRESS -> COMPLETED) مع التسوية المالية التلقائية. */
  @Post(":id/complete")
  complete(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.trips.driverChangeStatus(user.userId, id, "COMPLETED");
  }

  /** إلغاء الرحلة من طرف السائق (-> CANCELLED). */
  @Post(":id/cancel")
  cancel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: { reason?: string },
  ) {
    return this.trips.driverChangeStatus(
      user.userId,
      id,
      "CANCELLED",
      body?.reason,
    );
  }

  /** مسار الرحلة المحفوظ (نقاط GPS) — للسائق المالك فقط. */
  @Get(":id/track")
  track(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.trips.getTripTrack(user.userId, id);
  }
}
