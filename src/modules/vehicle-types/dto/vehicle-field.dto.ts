import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";

// أنواع الحقول الديناميكية المدعومة.
export const FIELD_TYPES = [
  "TEXT",
  "NUMBER",
  "BOOLEAN",
  "SELECT",
  "MULTISELECT",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** إنشاء حقل ديناميكي لنوع مركبة (مثل: هل يوجد ماء؟). */
export class CreateVehicleFieldDto {
  @IsString() @IsNotEmpty() vehicleTypeId!: string;
  @IsString() @IsNotEmpty() key!: string;
  @IsString() @IsNotEmpty() label!: string;
  @IsOptional() @IsObject() labelI18n?: Record<string, string>;
  @IsOptional() @IsIn(FIELD_TYPES) fieldType?: FieldType;
  @IsOptional() @IsArray() options?: unknown[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

/** تحديث حقل ديناميكي. */
export class UpdateVehicleFieldDto {
  @IsOptional() @IsString() @IsNotEmpty() key?: string;
  @IsOptional() @IsString() @IsNotEmpty() label?: string;
  @IsOptional() @IsObject() labelI18n?: Record<string, string>;
  @IsOptional() @IsIn(FIELD_TYPES) fieldType?: FieldType;
  @IsOptional() @IsArray() options?: unknown[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
