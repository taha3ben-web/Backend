import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { RideClass } from "@prisma/client";
import {
  USAGE_TYPES,
  UsageType,
  ICON_TYPES,
  IconType,
  WORKFLOW_STATUSES,
  WorkflowStatusValue,
} from "./vehicle-category.dto";

/** إنشاء نوع مركبة (خدمة كاملة) داخل فئة. */
export class CreateVehicleTypeDto {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() descriptionI18n?: Record<string, string>;

  // يُحتفظ به للتوافق مع البيانات القديمة فقط.
  @IsOptional() @IsEnum(RideClass) rideClass?: RideClass;

  @IsOptional() @IsNumber() @Min(0) multiplier?: number;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsInt() @Min(0) luggage?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(USAGE_TYPES) usageType?: UsageType;

  // خصائص الخدمة
  @IsOptional() @IsBoolean() allowsNegotiation?: boolean;
  @IsOptional() @IsBoolean() supportsCash?: boolean;
  @IsOptional() @IsBoolean() supportsWallet?: boolean;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsBoolean() visibleToPassengers?: boolean;
  @IsOptional() @IsBoolean() visibleToDrivers?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) appIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) clientOs?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) countryCodes?: string[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audienceSegments?: string[];
  @IsOptional() @IsString() minAppVersion?: string;
  @IsOptional() @IsString() maxAppVersion?: string;
  @IsOptional() @IsString() badgeText?: string;
  @IsOptional() @IsInt() etaMinutes?: number;

  // الأيقونات المرنة
  @IsOptional() @IsIn(ICON_TYPES) iconType?: IconType;
  @IsOptional() @IsString() iconValue?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() color?: string;

  // متطلبات القبول (يتحقق منها النظام تلقائيًا)
  @IsOptional() @IsInt() minVehicleYear?: number;
  @IsOptional() @IsNumber() @Min(0) minDriverRating?: number;
  @IsOptional() @IsInt() @Min(0) minDriverTrips?: number;
  @IsOptional() @IsString() requiredLicenseType?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) requiredPhotos?: string[];
  @IsOptional() @IsObject() requirements?: Record<string, unknown>;

  // دورة النشر (Workflow)
  @IsOptional() @IsIn(WORKFLOW_STATUSES) status?: WorkflowStatusValue;

  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;

  // ربط الميزات (معرّفات Features)
  @IsOptional() @IsArray() @IsString({ each: true }) featureIds?: string[];
}

/** تحديث نوع مركبة (كل الحقول اختيارية). */
export class UpdateVehicleTypeDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsObject() nameI18n?: Record<string, string>;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() descriptionI18n?: Record<string, string>;
  @IsOptional() @IsEnum(RideClass) rideClass?: RideClass;
  @IsOptional() @IsNumber() @Min(0) multiplier?: number;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsInt() @Min(0) luggage?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(USAGE_TYPES) usageType?: UsageType;

  @IsOptional() @IsBoolean() allowsNegotiation?: boolean;
  @IsOptional() @IsBoolean() supportsCash?: boolean;
  @IsOptional() @IsBoolean() supportsWallet?: boolean;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsBoolean() visibleToPassengers?: boolean;
  @IsOptional() @IsBoolean() visibleToDrivers?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) appIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) clientOs?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) countryCodes?: string[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  audienceSegments?: string[];
  @IsOptional() @IsString() minAppVersion?: string;
  @IsOptional() @IsString() maxAppVersion?: string;
  @IsOptional() @IsString() badgeText?: string;
  @IsOptional() @IsInt() etaMinutes?: number;

  @IsOptional() @IsIn(ICON_TYPES) iconType?: IconType;
  @IsOptional() @IsString() iconValue?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() color?: string;

  @IsOptional() @IsInt() minVehicleYear?: number;
  @IsOptional() @IsNumber() @Min(0) minDriverRating?: number;
  @IsOptional() @IsInt() @Min(0) minDriverTrips?: number;
  @IsOptional() @IsString() requiredLicenseType?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) requiredPhotos?: string[];
  @IsOptional() @IsObject() requirements?: Record<string, unknown>;

  @IsOptional() @IsIn(WORKFLOW_STATUSES) status?: WorkflowStatusValue;

  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;

  @IsOptional() @IsArray() @IsString({ each: true }) featureIds?: string[];
}
