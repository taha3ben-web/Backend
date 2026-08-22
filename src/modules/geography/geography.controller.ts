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
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { GeographyService } from "./geography.service";
import {
  AssignCityWilayaDto,
  BulkAssignCitiesDto,
  CreateWilayaCityDto,
  ListWilayasQueryDto,
  PublicCitiesQueryDto,
  UpdateWilayaDto,
} from "./dto/geography.dto";

/**
 * المرحلة 8 — إدارة الجغرافيا من لوحة التحكم.
 *
 * الصلاحية settings.manage وليست pricing.manage:
 * الجغرافيا بنية تشغيلية يعتمد عليها التسعير والسائقون والرحلات، فلا يصح أن
 * يُعطّل مسؤول تسعير ولاية بأكملها. القراءة متاحة لـ pricing.manage أيضًا
 * لأن شاشة التسعير تحتاج قائمة الولايات لاختيار نطاق القاعدة.
 */
@Controller("geography")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class GeographyAdminController {
  constructor(private readonly geography: GeographyService) {}

  @Get("wilayas")
  @RequirePermissions("settings.manage", "pricing.manage")
  listWilayas(@Query() query: ListWilayasQueryDto) {
    return this.geography.listWilayas({
      activeOnly: query.activeOnly === "true",
      operationalOnly: query.operationalOnly === "true",
      withCities: query.withCities === "true",
    });
  }

  @Get("coverage")
  @RequirePermissions("settings.manage", "pricing.manage")
  coverage() {
    return this.geography.coverage();
  }

  @Get("wilayas/:id")
  @RequirePermissions("settings.manage", "pricing.manage")
  findWilaya(@Param("id") id: string) {
    return this.geography.findWilaya(id);
  }

  @Patch("wilayas/:id")
  @RequirePermissions("settings.manage")
  updateWilaya(@Param("id") id: string, @Body() dto: UpdateWilayaDto) {
    return this.geography.updateWilaya(id, dto);
  }

  @Post("wilayas/:id/cities")
  @RequirePermissions("settings.manage")
  createCity(@Param("id") id: string, @Body() dto: CreateWilayaCityDto) {
    return this.geography.createCityInWilaya(id, dto);
  }

  @Patch("cities/:cityId/wilaya")
  @RequirePermissions("settings.manage")
  assignCity(
    @Param("cityId") cityId: string,
    @Body() dto: AssignCityWilayaDto,
  ) {
    return this.geography.assignCity(cityId, dto);
  }

  @Post("cities/bulk-assign")
  @RequirePermissions("settings.manage")
  bulkAssign(@Body() dto: BulkAssignCitiesDto) {
    return this.geography.bulkAssignCities(dto);
  }
}

/**
 * المرحلة 8 — قراءة الجغرافيا للتطبيقين (راكب / سائق).
 *
 * لماذا وجد هذا المتحكّم:
 * قبل المرحلة 8، قائمة المدن كانت خلف GET /cities المحمية بـ STAFF + settings.manage،
 * فلم يكن بإمكان تطبيق السائق عرض منتقي مدن إطلاقًا (موثّق في ProfileScreen).
 * البديل السيئ كان سيكون نسخ قائمة الولايات داخل التطبيق، وهو ممنوع هنا.
 *
 * مصادَق عليه (JwtAuthGuard) لكن دون قيد دور أو صلاحية: التقسيم الإداري
 * للجزائر معلومة عمومية وليس فيه أي بيانات حساسة.
 */
@Controller("geography")
@UseGuards(JwtAuthGuard)
export class GeographyPublicController {
  constructor(private readonly geography: GeographyService) {}

  /**
   * افتراضيًا يرجع مناطق التشغيل فقط، لأن عرض 69 ولاية للسائق بينما نخدم
   * بعضها ينتج تسجيلات في مناطق لا عمل فيها. all=true للحالات التي تحتاج
   * القائمة الكاملة (مثل عنوان في وثيقة هوية).
   */
  @Get("public/wilayas")
  wilayas(@Query("all") all?: string) {
    return this.geography.publicWilayas(all !== "true");
  }

  /**
   * المرحلة ب: زر "تحديد تلقائي" في شاشة التسجيل.
   * مثال: /api/geography/public/resolve-wilaya?lat=36.75&lng=3.06
   */
  @Get("public/resolve-wilaya")
  resolveWilaya(@Query("lat") lat: string, @Query("lng") lng: string) {
    return this.geography.resolveWilayaByPoint(Number(lat), Number(lng));
  }

  @Get("public/cities")
  cities(@Query() query: PublicCitiesQueryDto) {
    return this.geography.publicCities({
      wilayaId: query.wilayaId,
      wilayaNumber: query.wilayaNumber
        ? Number(query.wilayaNumber)
        : undefined,
    });
  }
}
