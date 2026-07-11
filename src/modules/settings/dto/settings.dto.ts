import { Type } from "class-transformer";
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

/** تحديث/إنشاء إعداد واحد (upsert حسب key). value يقبل أي شكل JSON. */
export class UpsertSettingDto {
  @IsString()
  @IsNotEmpty()
  declare key: string;

  // قيمة JSON حرة (كائن/مصفوفة/نص/رقم/منطقي)
  declare value: unknown;

  @IsOptional()
  @IsString()
  group?: string;
}

/** تحديث قيمة إعداد موجود (المفتاح يأتي من المسار). */
export class UpdateSettingValueDto {
  declare value: unknown;

  @IsOptional()
  @IsString()
  group?: string;
}

/** تحديث دفعي لعدة إعدادات مرّة واحدة. */
export class BulkSettingItemDto {
  @IsString()
  @IsNotEmpty()
  declare key: string;

  declare value: unknown;

  @IsOptional()
  @IsString()
  group?: string;
}

export class BulkUpsertSettingsDto {
  @ValidateNested({ each: true })
  @Type(() => BulkSettingItemDto)
  declare items: BulkSettingItemDto[];
}

// ---------- المدن ----------
export class CreateCityDto {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  centerLng?: number;
}

export class UpdateCityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  centerLng?: number;
}

// ---------- المناطق ----------
export class CreateZoneDto {
  @IsString()
  @IsNotEmpty()
  declare cityId: string;

  @IsString()
  @IsNotEmpty()
  declare name: string;

  // polygon: GeoJSON-لايك (مصفوفة إحداثيات) أو أي شكل JSON
  @IsOptional()
  @IsObject()
  polygon?: Record<string, unknown>;
}

export class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsObject()
  polygon?: Record<string, unknown>;
}
