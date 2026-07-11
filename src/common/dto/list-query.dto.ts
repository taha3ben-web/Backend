import { Type } from "class-transformer";
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

/**
 * استعلام قوائم موحّد: بحث + ترقيم + ترتيب + ترشيح.
 * تستخدمه كل قوائم الكتالوج.
 */
export class ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder: "asc" | "desc" = "desc";

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBooleanString()
  includeDeleted?: string; // "true" لتضمين المحذوف ناعمًا

  @IsOptional()
  @IsBooleanString()
  activeOnly?: string; // "true" للمفعّل فقط

  // مُرشّحات اختيارية خاصة ببعض القوائم (تُسمح مع whitelist).
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  vehicleTypeId?: string;
}
