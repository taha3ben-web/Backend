import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const SETTING_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export class UpsertSettingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(SETTING_KEY_PATTERN)
  declare key: string;

  @IsDefined()
  declare value: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  group?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;
}

export class UpdateSettingValueDto {
  @IsOptional()
  value?: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  group?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;
}

export class BulkSettingItemDto extends UpsertSettingDto {}

export class BulkUpsertSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSettingItemDto)
  declare items: BulkSettingItemDto[];
}

export class CreateCityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  declare name: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  country?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;
}

export class UpdateCityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  country?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;
}

export class CreateZoneDto {
  @IsString()
  @IsNotEmpty()
  declare cityId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  declare name: string;

  @IsOptional()
  @IsObject()
  polygon?: Record<string, unknown>;
}

export class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cityId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  polygon?: Record<string, unknown>;
}
