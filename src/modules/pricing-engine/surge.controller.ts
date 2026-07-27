import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";
import { SurgeService } from "./surge.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";

export class SurgePointDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class SurgeHeatmapDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  minutes?: number;
}

/**
 * قراءة التسعير الديناميكي الحيّ.
 * الشفافية إلزامية: الراكب يرى لماذا ارتفع السعر، والسائق يرى أين يتجه.
 */
@UseGuards(JwtAuthGuard)
@Controller("surge")
export class SurgeController {
  constructor(private readonly surge: SurgeService) {}

  /** مضاعف الطلب عند نقطة (مع الطلب والعرض الفعليين). */
  @Get()
  at(@Query() dto: SurgePointDto) {
    return this.surge.snapshotAt(dto.lat, dto.lng);
  }

  /** خريطة حرارية للطلب الحالي — يستخدمها تطبيق السائق. */
  @Get("heatmap")
  heatmap(@Query() dto: SurgeHeatmapDto) {
    return this.surge.heatmap(dto.minutes);
  }
}
