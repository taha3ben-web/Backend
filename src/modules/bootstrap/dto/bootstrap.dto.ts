import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const AUDIENCES = ["passenger", "driver", "all"] as const;

/**
 * سياق طلب Bootstrap القادم من التطبيق (كلها اختيارية).
 * تُمرّر لمكوّنات التجميع (إصدارات/كتالوج/ميزات/قانوني).
 */
export class BootstrapContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientOs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  releaseChannel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  usageType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];

  /** شرائح الجمهور مفصولة بفاصلة (مثل: "vip,beta"). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  segments?: string;
}

/**
 * معاينة Bootstrap من اللوحة (STAFF): نفس السياق + هوية محاكاة
 * (subjectId لتوزيع الطرح، وrole لتحديد الجمهور القانوني).
 */
export class BootstrapPreviewDto extends BootstrapContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  role?: string;
}
