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
import { SubscriptionsService } from "./subscriptions.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  CancelSubscriptionDto,
  CreatePlanDto,
  SubscribeDto,
  UpdatePlanDto,
} from "./dto/subscriptions.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** الخطط المتاحة للاشتراك (المفعّلة فقط) — لتطبيق الراكب. */
  @Get("plans")
  plans() {
    return this.subscriptions.listPlans(false);
  }

  /** اشتراك المستخدم الحالي (الأحدث) إن وُجد. */
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getMySubscription(user.userId);
  }

  /** الاشتراك في خطة (يُخصم الرسم من المحفظة). */
  @Post("subscribe")
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscribeDto) {
    return this.subscriptions.subscribe(user.userId, dto.planId);
  }

  /** إلغاء التجديد التلقائي (يبقى فعّالًا حتى نهاية الفترة المدفوعة). */
  @Post("cancel")
  cancel(@CurrentUser() user: AuthUser, @Body() dto: CancelSubscriptionDto) {
    return this.subscriptions.cancel(user.userId, dto.subscriptionId);
  }

  // ---------- إدارة (STAFF) ----------
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("subscriptions.manage")
  @Get("plans/all")
  allPlans() {
    return this.subscriptions.listPlans(true);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("subscriptions.manage")
  @Get()
  findAll(@Query() q: PaginationDto) {
    return this.subscriptions.adminList(q);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("subscriptions.manage")
  @Post("plans")
  createPlan(@Body() dto: CreatePlanDto) {
    return this.subscriptions.createPlan(dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("subscriptions.manage")
  @Patch("plans/:id")
  updatePlan(@Param("id") id: string, @Body() dto: UpdatePlanDto) {
    return this.subscriptions.updatePlan(id, dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("subscriptions.manage")
  @Delete("plans/:id")
  deactivatePlan(@Param("id") id: string) {
    return this.subscriptions.deactivatePlan(id);
  }
}
