import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

// أغراض الاستخدام مرنة: رحلات، توصيل، أو كليهما.
export const USAGE_TYPES = ["RIDE", "DELIVERY", "BOTH"] as const;
export type UsageType = (typeof USAGE_TYPES)[number];

// أنواع الأيقونات المدعومة.
export const ICON_TYPES = ["EMOJI", "ICON_PACK", "SVG", "PNG", "LOTTIE"] as const;
export type IconType = (typeof ICON_TYPES)[number];

// حالات دورة النشر (Workflow).
export const WORKFLOW_STATUSES = [
  "DRAFT",
  "PENDING",
  "PUBLISHED",
  "ARCHIVED",
] as const;
export type WorkflowStatusValue = (typeof WORKFLOW_STATUSES)[number];

// مجالات الأعمال (لإعادة الاستخدام مستقبلًا: توصيل طعام، طرود، شركات، تأجير).
export const CATALOG_DOMAINS = [
  "MOBILITY",
  "FOOD",
  "PARCEL",
  "CORPORATE",
  "RENTAL",
] as const;
export type CatalogDomain = (typeof CATALOG_DOMAINS)[number];

/** إنشاء فئة مركبات جديدة. */
export class CreateVehicleCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() descriptionI18n?: Record<string, string>;
  @IsOptional() @IsIn(ICON_TYPES) iconType?: IconType;
  @IsOptional() @IsString() iconValue?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsIn(USAGE_TYPES) usageType?: UsageType;
  @IsOptional() @IsIn(CATALOG_DOMAINS) domain?: CatalogDomain;
  @IsOptional() @IsIn(WORKFLOW_STATUSES) status?: WorkflowStatusValue;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

/** تحديث فئة (كل الحقول اختيارية). */
export class UpdateVehicleCategoryDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() descriptionI18n?: Record<string, string>;
  @IsOptional() @IsIn(ICON_TYPES) iconType?: IconType;
  @IsOptional() @IsString() iconValue?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsIn(USAGE_TYPES) usageType?: UsageType;
  @IsOptional() @IsIn(CATALOG_DOMAINS) domain?: CatalogDomain;
  @IsOptional() @IsIn(WORKFLOW_STATUSES) status?: WorkflowStatusValue;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

/** عنصر ترتيب واحد. */
export class ReorderItemDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsInt() sortOrder!: number;
}

/** إعادة ترتيب مجموعة عناصر. */
export class ReorderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}

/** تغيير حالة النشر (Workflow). */
export class SetStatusDto {
  @IsIn(WORKFLOW_STATUSES) status!: WorkflowStatusValue;
}
