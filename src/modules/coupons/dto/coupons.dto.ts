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
  Min,
} from "class-validator";
import { DiscountType } from "@prisma/client";

export class CreateCouponDto {
  @IsString()
  code!: string;

  @IsEnum(DiscountType)
  @IsOptional()
  type?: DiscountType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  value!: number;

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
}

export class ValidateCouponDto {
  @IsString()
  code!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  fare!: number;
}
