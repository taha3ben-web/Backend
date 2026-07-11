import { Type } from "class-transformer";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";
import { RideClass } from "@prisma/client";

/** طلب تسعير مباشر من محرك التسعير (للاختبار/الاستخدام العام). */
export class PricingQuoteDto {
  @IsString()
  @IsOptional()
  vehicleTypeId?: string;

  @IsEnum(RideClass)
  @IsOptional()
  rideClass?: RideClass;

  @IsString()
  @IsOptional()
  cityId?: string;

  @IsString()
  @IsOptional()
  serviceAreaId?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  customerType?: string;

  @IsString()
  @IsOptional()
  couponCode?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  distanceKm?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  durationSec?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  pickupLat?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  pickupLng?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  destLat?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  destLng?: number;
}
