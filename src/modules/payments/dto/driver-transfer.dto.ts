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
import { DriverTransferStatus } from "@prisma/client";

export class CreateDriverTransferDto {
  @IsString()
  declare fromDriverId: string;

  @IsString()
  declare toDriverId: string;

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

export class ProcessDriverTransferDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class UpdateDriverTransferStatusDto {
  @IsEnum(DriverTransferStatus)
  declare status: DriverTransferStatus;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}
