import { Type } from "class-transformer";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { FundingRequestStatus } from "@prisma/client";

export class CreateDriverFundingRequestDto {
  @IsString()
  declare driverId: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Min(1)
  declare amount: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class UpdateDriverFundingRequestDto {
  @IsEnum(FundingRequestStatus)
  declare status: FundingRequestStatus;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class ProcessDriverFundingRequestDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}
