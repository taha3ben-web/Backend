import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { PaymentMethod, RideClass } from "@prisma/client";

/** محطة توقّف وسيطة يمرّ بها السائق قبل الوجهة النهائية */
export class TripStopDto {
  @Type(() => Number)
  @IsLatitude()
  declare lat: number;

  @Type(() => Number)
  @IsLongitude()
  declare lng: number;

  @IsString()
  @IsOptional()
  address?: string;
}

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

  // محطات توقّف وسيطة اختيارية بترتيب مرورها (بحد أقصى ثلاث محطات).
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => TripStopDto)
  @IsOptional()
  stops?: TripStopDto[];
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
