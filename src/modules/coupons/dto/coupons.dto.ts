import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
} from "class-validator";
import { CouponFundingSource, DiscountType, RideClass } from "@prisma/client";

export class CreateCouponDto {
  @IsString()
  declare code: string;

  @IsEnum(DiscountType)
  @IsOptional()
  type?: DiscountType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  declare value: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  /** حد الاستخدام لكل راكب. بدونه يمكن لراكب واحد استنفاد كل maxUses. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  perUserLimit?: number;

  @IsBoolean()
  @IsOptional()
  firstRideOnly?: boolean;

  @IsString()
  @IsOptional()
  userId?: string;

  /** أقل أجرة (قبل الخصم) يصلح معها الكوبون. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minFare?: number;

  /** سقف مبلغ الخصم، مهم خاصة لكوبونات النسبة. */
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsOptional()
  maxDiscount?: number;

  /** فئات الرحلة المسموحة. فارغ = كل الفئات. */
  @IsArray()
  @IsEnum(RideClass, { each: true })
  @IsOptional()
  rideClasses?: RideClass[];

  /** تقييد بمدينة. فارغ = كل المدن. */
  @IsString()
  @IsOptional()
  cityId?: string;

  @IsISO8601()
  @IsOptional()
  expiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsEnum(CouponFundingSource)
  @IsOptional()
  fundingSource?: CouponFundingSource;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  platformShare?: number;
}

export class UpdateCouponDto {
  @IsEnum(DiscountType)
  @IsOptional()
  type?: DiscountType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsOptional()
  value?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  perUserLimit?: number;

  @IsBoolean()
  @IsOptional()
  firstRideOnly?: boolean;

  @IsString()
  @IsOptional()
  userId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minFare?: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsOptional()
  maxDiscount?: number;

  @IsArray()
  @IsEnum(RideClass, { each: true })
  @IsOptional()
  rideClasses?: RideClass[];

  @IsString()
  @IsOptional()
  cityId?: string;

  @IsISO8601()
  @IsOptional()
  expiresAt?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsEnum(CouponFundingSource)
  @IsOptional()
  fundingSource?: CouponFundingSource;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  platformShare?: number;
}

export class ValidateCouponDto {
  @IsString()
  declare code: string;

  /**
   * 0 = معاينة صلاحية بلا رحلة (شاشة الكوبونات في التطبيق).
   * كان @IsPositive يرفض هذه الحالة بـ 400 فتظهر كل الكوبونات كأنها غير صالحة.
   */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  declare fare: number;

  /**
   * الفئة والمدينة لمعاينة أدق فقط. القيمة الملزِمة تُعاد من الخادم
   * عند طلب الرحلة من عرض السعر المحسوب، فلا يُوثق بهذه المدخلات ماليًا.
   */
  @IsEnum(RideClass)
  @IsOptional()
  rideClass?: RideClass;

  @IsString()
  @IsOptional()
  cityId?: string;
}
