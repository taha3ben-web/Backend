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
import { FareOfferStatus } from "@prisma/client";

/** عرض مضاد من السائق على عرض سعر (FareQuote). */
export class CreateFareOfferDto {
  @IsString()
  fareQuoteId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  etaMinutes?: number;
}

/** مرشّحات قائمة اللوحة لعروض السائقين. */
export class AdminFareOfferQueryDto {
  @IsOptional()
  @IsEnum(FareOfferStatus)
  status?: FareOfferStatus;

  @IsOptional()
  @IsString()
  fareQuoteId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
