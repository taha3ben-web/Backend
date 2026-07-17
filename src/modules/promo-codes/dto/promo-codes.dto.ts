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
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { DiscountType } from "@prisma/client";

export class CreatePromoCodeDto {
  @IsString()
  declare code: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // للاستبدال (رصيد محفظة) يُستخدم FIXED فقط؛ PERCENT متاح للتوافق مع المخطط.
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  declare value: number;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  maxRedemptions?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromoCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsOptional()
  value?: number;

  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  maxRedemptions?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RedeemPromoCodeDto {
  @IsString()
  declare code: string;
}
