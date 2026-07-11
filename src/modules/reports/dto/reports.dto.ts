import { Type } from "class-transformer";
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";

export enum ReportType {
  REVENUE = "revenue",
  TRIPS = "trips",
  DRIVERS = "drivers",
  PASSENGERS = "passengers",
  TOP_DRIVERS = "top-drivers",
  TOP_CITIES = "top-cities",
}

export enum ReportFormat {
  PDF = "pdf",
  EXCEL = "excel",
}

/** نطاق تاريخي اختياري للإحصائيات */
export class DateRangeDto {
  @IsISO8601()
  @IsOptional()
  from?: string;

  @IsISO8601()
  @IsOptional()
  to?: string;
}

/** طلب تقرير قابل للتنزيل */
export class ReportQueryDto extends DateRangeDto {
  @IsEnum(ReportFormat)
  declare format: ReportFormat;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
