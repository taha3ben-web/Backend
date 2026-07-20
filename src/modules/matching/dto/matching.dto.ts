import { Type } from "class-transformer";
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";
import { PaymentMethod, RideClass } from "@prisma/client";

/** طلب رحلة جديدة من الراكب */
export class RequestRideDto {
  @Type(() => Number)
  @IsLatitude()
  declare pickupLat: number;

  @Type(() => Number)
  @IsLongitude()
  declare pickupLng: number;

  @IsString()
  @IsOptional()
  pickupAddress?: string;

  @Type(() => Number)
  @IsLatitude()
  declare destLat: number;

  @Type(() => Number)
  @IsLongitude()
  declare destLng: number;

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

  // طريقة الدفع المختارة من الراكب (نقدي/محفظة/بطاقة). الافتراضي نقدي.
  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;
}

/** تقدير الأجرة قبل الطلب */
export class QuoteDto {
  @Type(() => Number)
  @IsNumber()
  declare pickupLat: number;

  @Type(() => Number)
  @IsNumber()
  declare pickupLng: number;

  @Type(() => Number)
  @IsNumber()
  declare destLat: number;

  @Type(() => Number)
  @IsNumber()
  declare destLng: number;

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
