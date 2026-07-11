import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

// مزوّدو الخرائط المدعومون (تصميم عام دون تغيير قاعدة البيانات).
export const MAP_PROVIDERS = ["GEOJSON", "GOOGLE"] as const;
export type MapProvider = (typeof MAP_PROVIDERS)[number];

/** إنشاء منطقة خدمة. */
export class CreateServiceAreaDto {
  @IsString() @IsNotEmpty() declare name: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsObject() geojson?: Record<string, unknown>; // Polygon / GeoJSON
  @IsOptional() @IsIn(MAP_PROVIDERS) provider?: MapProvider;
  @IsOptional() @IsObject() providerRef?: Record<string, unknown>;
  @IsOptional() @IsNumber() centerLat?: number;
  @IsOptional() @IsNumber() centerLng?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

/** تحديث منطقة خدمة. */
export class UpdateServiceAreaDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsObject() geojson?: Record<string, unknown>;
  @IsOptional() @IsIn(MAP_PROVIDERS) provider?: MapProvider;
  @IsOptional() @IsObject() providerRef?: Record<string, unknown>;
  @IsOptional() @IsNumber() centerLat?: number;
  @IsOptional() @IsNumber() centerLng?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
