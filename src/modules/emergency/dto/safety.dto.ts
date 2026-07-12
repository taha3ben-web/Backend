import { SafetyIncidentStatus, SafetyIncidentType } from "@prisma/client";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateSafetyIncidentDto {
  @IsOptional()
  @IsString()
  tripId?: string;

  @IsOptional()
  @IsEnum(SafetyIncidentType)
  type?: SafetyIncidentType;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsString()
  @MaxLength(160)
  declare idempotencyKey: string;
}

export class ResolveSafetyIncidentDto {
  @IsEnum(SafetyIncidentStatus)
  declare status: SafetyIncidentStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
