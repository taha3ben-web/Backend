import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { BackupKind, BackupStatus, BackupTrigger } from "@prisma/client";
import { PaginationDto } from "../../../common/dto/pagination.dto";

export class CreateBackupDto {
  @IsOptional()
  @IsEnum(BackupKind)
  kind?: BackupKind;

  @IsOptional()
  @IsEnum(BackupTrigger)
  trigger?: BackupTrigger;

  @IsOptional()
  @IsEnum(BackupStatus)
  status?: BackupStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  storageLocation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeMb?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  checksum?: string;

  @IsOptional()
  @IsString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  error?: string;
}

export class UpdateBackupDto {
  @IsOptional()
  @IsEnum(BackupStatus)
  status?: BackupStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  storageLocation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeMb?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  checksum?: string;

  @IsOptional()
  @IsString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  error?: string;
}

export class QueryBackupsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(BackupKind)
  kind?: BackupKind;

  @IsOptional()
  @IsEnum(BackupStatus)
  status?: BackupStatus;
}

export class DrStatusQueryDto {
  @IsOptional()
  @IsEnum(BackupKind)
  kind?: BackupKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rpoMinutes?: number;
}

export class ApplyRetentionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  keepLatest?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  keepDaily?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  keepWeekly?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  keepMonthly?: number;

  // "true" → محاكاة دون تطبيق فعلي.
  @IsOptional()
  @IsString()
  dryRun?: string;
}
