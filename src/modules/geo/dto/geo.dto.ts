import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { SavedPlaceKind } from "@prisma/client";

/** إكمال تلقائي للعناوين (autocomplete). */
export class AutocompleteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare q: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  country?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

/** تحويل عنوان نصي إلى إحداثيات (geocoding). */
export class GeocodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  declare q: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  country?: string;
}

/** تحويل إحداثيات إلى عنوان (reverse geocoding). */
export class ReverseGeocodeDto {
  @Type(() => Number)
  @IsLatitude()
  declare lat: number;

  @Type(() => Number)
  @IsLongitude()
  declare lng: number;
}

export class GeoPointDto {
  @Type(() => Number)
  @IsLatitude()
  declare lat: number;

  @Type(() => Number)
  @IsLongitude()
  declare lng: number;
}

/** حسم نقطة داخل الأحياء/مناطق الخدمة (مع تقييد اختياري بمدينة). */
export class GeoResolveDto {
  @Type(() => Number)
  @IsLatitude()
  declare lat: number;

  @Type(() => Number)
  @IsLongitude()
  declare lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cityId?: string;
}

/** حساب المسار/الزمن/المسافة (ETA + polyline). */
export class DirectionsDto {
  @ValidateNested()
  @Type(() => GeoPointDto)
  declare origin: GeoPointDto;

  @ValidateNested()
  @Type(() => GeoPointDto)
  declare destination: GeoPointDto;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => GeoPointDto)
  waypoints?: GeoPointDto[];
}

export class CreateSavedPlaceDto {
  @IsOptional()
  @IsEnum(SavedPlaceKind)
  kind?: SavedPlaceKind;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  declare label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  declare address: string;

  @Type(() => Number)
  @IsLatitude()
  declare lat: number;

  @Type(() => Number)
  @IsLongitude()
  declare lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  placeId?: string;
}

export class UpdateSavedPlaceDto {
  @IsOptional()
  @IsEnum(SavedPlaceKind)
  kind?: SavedPlaceKind;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  placeId?: string;
}

/** تسجيل مكان أخير (recent) بعد رحلة/بحث. */
export class RecordRecentPlaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  declare label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  declare address: string;

  @Type(() => Number)
  @IsLatitude()
  declare lat: number;

  @Type(() => Number)
  @IsLongitude()
  declare lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  placeId?: string;
}

/** تحديث إعدادات مزوّد الخرائط (STAFF) — يُخزّن في Settings. */
export class UpdateGeoProviderConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  serverApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  clientApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  defaultCountry?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  @Max(200)
  averageSpeedKmh?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  osrmBaseUrl?: string;
}
