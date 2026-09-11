import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class CreateCommissionRuleDto {
  @IsOptional() @IsString() name?: string;

  /** ISO-3166-1 alpha-2. اتركه فارغًا ليعني «كل الدول». */
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;

  @IsOptional() @IsString() cityId?: string;
  @IsOptional() @IsString() vehicleTypeId?: string;
  @IsOptional() @IsString() vehicleCategoryId?: string;

  /**
   * نسبة العمولة (0..100). إلزامية بلا قيمة افتراضية: اللوحة هي المصدر
   * الوحيد للنسبة، ولا يجوز للخادم أن يخترع رقمًا.
   */
  @IsNumber() @Min(0) @Max(100) commissionPct!: number;

  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() note?: string;
}

export class UpdateCommissionRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string | null;
  @IsOptional() @IsString() cityId?: string | null;
  @IsOptional() @IsString() vehicleTypeId?: string | null;
  @IsOptional() @IsString() vehicleCategoryId?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) commissionPct?: number;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() note?: string;
}

/** استعلام «ما هي العمولة الفعّالة لهذا النطاق؟» من اللوحة. */
export class EffectiveCommissionQueryDto {
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @IsOptional() @IsString() cityId?: string;
  @IsOptional() @IsString() vehicleTypeId?: string;
  @IsOptional() @IsString() vehicleCategoryId?: string;
}
