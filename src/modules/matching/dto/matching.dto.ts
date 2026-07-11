import { Type } from "class-transformer";
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";
import { RideClass } from "@prisma/client";

/** طلب رحلة جديدة من الراكب */
export class RequestRideDto {
  @Type(() => Number)
  @IsLatitude()
  pickupLat!: number;

  @Type(() => Number)
  @IsLongitude()
  pickupLng!: number;

  @IsString()
  @IsOptional()
  pickupAddress?: string;

  @Type(() => Number)
  @IsLatitude()
  destLat!: number;

  @Type(() => Number)
  @IsLongitude()
  destLng!: number;

  @IsString()
  @IsOptional()
  destAddress?: string;

  @IsEnum(RideClass)
  @IsOptional()
  rideClass?: RideClass;

  // معرّف نوع المركبة الديناميكي (النظام الجديد المُدار من لوحة التحكم)
  @IsString()
  @IsOptional()
  vehicleTypeId?: string;

  @IsString()
  @IsOptional()
  cityId?: string;

  // كود كوبون اختياري لتطبيق خصم على الأجرة
  @IsString()
  @IsOptional()
  couponCode?: string;
}

/** تقدير الأجرة قبل الطلب */
export class QuoteDto {
  @Type(() => Number)
  @IsNumber()
  pickupLat!: number;

  @Type(() => Number)
  @IsNumber()
  pickupLng!: number;

  @Type(() => Number)
  @IsNumber()
  destLat!: number;

  @Type(() => Number)
  @IsNumber()
  destLng!: number;

  @IsEnum(RideClass)
  @IsOptional()
  rideClass?: RideClass;

  // معرّف نوع المركبة الديناميكي (النظام الجديد المُدار من لوحة التحكم)
  @IsString()
  @IsOptional()
  vehicleTypeId?: string;

  @IsString()
  @IsOptional()
  cityId?: string;
}
