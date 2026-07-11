import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import { ICON_TYPES, IconType } from "./vehicle-category.dto";

/** إنشاء ميزة مرنة (مكيف/براد/واي فاي...). */
export class CreateFeatureDto {
  @IsString() @IsNotEmpty() declare code: string;
  @IsString() @IsNotEmpty() declare name: string;
  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsIn(ICON_TYPES) iconType?: IconType;
  @IsOptional() @IsString() iconValue?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

/** تحديث ميزة. */
export class UpdateFeatureDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsIn(ICON_TYPES) iconType?: IconType;
  @IsOptional() @IsString() iconValue?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
