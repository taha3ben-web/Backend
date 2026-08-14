import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * المرحلة 8 — DTOs الجغرافيا.
 *
 * لا يوجد CreateWilayaDto عمدًا: الولايات بيانات مرجعية رسمية تأتي من
 * prisma/data/algeria-wilayas.ts عبر الـseed. السماح للموظفين بإنشاء ولايات
 * يعني أن تصبح قاعدة البيانات مخالفة للتقسيم الإداري الرسمي. المتاح للإدارة هو
 * التشغيل (تفعيل/تعطيل) وتصحيح الإحداثيات فقط.
 */
export class UpdateWilayaDto {
  /** الولاية معترف بها إداريًا داخل النظام */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** flaminGO يعمل فعليًا في هذه الولاية (منطقة تشغيل) */
  @IsOptional()
  @IsBoolean()
  isOperational?: boolean;

  /** تصحيح إحداثيات المركز — للعرض والتوسيط فقط، لا لحساب المسافة */
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;
}

/** ترشيح قائمة الولايات */
export class ListWilayasQueryDto {
  /** "true" = المفعّلة فقط */
  @IsOptional()
  @IsString()
  activeOnly?: string;

  /** "true" = مناطق التشغيل فقط */
  @IsOptional()
  @IsString()
  operationalOnly?: string;

  /** إرفاق مدن كل ولاية */
  @IsOptional()
  @IsString()
  withCities?: string;
}

/** ربط مدينة موجودة بولاية (أو فك الربط بـ null) */
export class AssignCityWilayaDto {
  @IsOptional()
  @IsUUID()
  wilayaId?: string | null;
}

/** إسناد جماعي: مفيد لربط المدن القديمة دفعة واحدة بعد الترحيل */
export class BulkAssignCitiesDto {
  @IsString({ each: true })
  cityIds!: string[];

  @IsOptional()
  @IsUUID()
  wilayaId?: string | null;
}

/** إنشاء مدينة داخل ولاية من شاشة الجغرافيا */
export class CreateWilayaCityDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;
}

/** استعلام التطبيقات عن مدن ولاية معينة */
export class PublicCitiesQueryDto {
  @IsOptional()
  @IsUUID()
  wilayaId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(69)
  wilayaNumber?: number;
}
