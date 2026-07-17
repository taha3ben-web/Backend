import { Type } from "class-transformer";
import {
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
import { CouponFundingSource, DiscountType } from "@prisma/client";

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

  @IsBoolean()
  @IsOptional()
  firstRideOnly?: boolean;

  @IsString()
  @IsOptional()
  userId?: string;

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

  @IsBoolean()
  @IsOptional()
  firstRideOnly?: boolean;

  @IsString()
  @IsOptional()
  userId?: string;

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

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  declare fare: number;
}
