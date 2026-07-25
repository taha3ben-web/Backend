import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { FareQuoteStatus, RideClass } from "@prisma/client";

/**
 * طلب عرض سعر تفاوضي من الراكب. الإحداثيات مطلوبة لاشتقاق المسافة،
 * ويمكن تمرير distanceKm/durationSec جاهزين لتجاوز الحساب الجغرافي.
 */
export class CreateFareQuoteDto {
  @IsOptional()
  @IsString()
  vehicleTypeId?: string;

  @IsOptional()
  @IsEnum(RideClass)
  rideClass?: RideClass;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  serviceAreaId?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  customerType?: string;

  @IsOptional()
  @IsString()
  couponCode?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickupLat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  pickupLng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  pickupAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  destLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  destLng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  destAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  distanceKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  durationSec?: number;
}

/** اقتراح الراكب لسعر ضمن النطاق المسموح. */
export class ProposeFareDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  fare!: number;

  /** رسالة اختيارية من الراكب تظهر للسائقين مع السعر المقترح. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** محاكاة عرض سعر من اللوحة (دون حفظ). نفس حقول الإنشاء. */
export class SimulateFareQuoteDto extends CreateFareQuoteDto {}

/** مرشّحات قائمة اللوحة. */
export class AdminFareQuoteQueryDto {
  @IsOptional()
  @IsEnum(FareQuoteStatus)
  status?: FareQuoteStatus;

  @IsOptional()
  @IsString()
  passengerId?: string;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
