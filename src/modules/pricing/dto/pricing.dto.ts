import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";
import { RideClass } from "@prisma/client";

export class CreatePricingRuleDto {
  @IsString()
  @IsOptional()
  cityId?: string;

  @IsEnum(RideClass)
  @IsOptional()
  rideClass?: RideClass;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseFare!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  perKm!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  perMin!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minFare!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxFare?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdatePricingRuleDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  baseFare?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  perKm?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  perMin?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minFare?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxFare?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreatePeakPricingDto {
  @IsString()
  pricingRuleId!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  multiplier!: number;

  // HH:mm
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime!: string;

  // 0=الأحد ... 6=السبت
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  daysOfWeek?: number[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
