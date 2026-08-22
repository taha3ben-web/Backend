import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export const RIDE_CLASSES = ["ECONOMY", "COMFORT", "VAN", "XL", "CAR", "BIKE"] as const;
export const DOC_TYPES = [
  "LICENSE",
  "ID_CARD",
  "INSURANCE",
  "REGISTRATION",
  "PROFILE_PHOTO",
  // المرحلة أ: النوعان اللذان يرفعهما تطبيق السائق فعليًا وكانا يُردّان بـ 400.
  "CARTE_GRISE",
  "TECHNICAL_INSPECTION",
  // المرحلة ب: صورة أمامية للمركبة تظهر فيها اللوحة — مكان رخصة النقل VTC.
  "VEHICLE_FRONT_PHOTO",
] as const;

/**
 * الوثائق الأربع التي تحجب اعتماد ملف السائق — نفس القائمة المستخدمة
 * في تطبيق السائق (REQUIRED_DRIVER_DOC_TYPES) حتى لا تختلف الجهتان.
 * ملاحظة: القائمة النهائية لكل نوع مركبة تأتي من لوحة التحكم
 * (VehicleType.requiredDocuments)؛ هذه هي الأرضية المشتركة فقط.
 */
export const REQUIRED_DRIVER_DOC_TYPES = [
  "LICENSE",
  "CARTE_GRISE",
  "TECHNICAL_INSPECTION",
  "INSURANCE",
] as const;

/** تحديث ملف السائق ومركبته النشطة */
export class UpdateDriverProfileDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(24) phone?: string;
  @IsOptional() @IsString() @MaxLength(60) carMake?: string;
  @IsOptional() @IsString() @MaxLength(60) carModel?: string;
  @IsOptional() @IsString() @MaxLength(30) carColor?: string;
  @IsOptional() @IsString() @MaxLength(20) carPlate?: string;
  @IsOptional() @IsInt() @Min(1970) carYear?: number;
  @IsOptional() @IsString() cityId?: string;
  /**
   * المرحلة ب: السائق يختار الولاية فقط عند التسجيل
   * (من قائمة اللوحة أو تلقائيًا من GPS)، ولا يُطلب منه اختيار مدينة.
   */
  @IsOptional() @IsString() wilayaId?: string;
  /**
   * المرحلة ب: الصورة الشخصية تتغير فورًا بلا موافقة من اللوحة.
   * تُقبل قيمة مفتاح التخزين (objectPath) أو رابطًا أرجعناه سابقًا.
   * المراجعة تبقى لوثائق الهوية والمركبة فقط، لا للأفاتار.
   */
  @IsOptional() @IsString() photoUrl?: string;
  /**
   * نوع المركبة المطلوب كما اختاره السائق في شاشة الوطائق
   * (سيارة اقتصادية / confort / نسائية / دراجة نارية …).
   *
   * ليس قرارًا نهائيًا: يُقبل فقط ما دامت المركبة غير معتمدة، ويبقى
   * الاعتماد النهائي للإدارة عبر PATCH /vehicles/:id/verify. أي تغيير للنوع
   * يُرجع المركبة إلى PENDING، ومركبة معتمدة تُرفض بـ 400 لا بتجاوز صامت.
   */
  @IsOptional() @IsString() vehicleTypeId?: string;
}

/** تبديل توفّر السائق (اتصال/قطع) */
export class SetAvailabilityDto {
  @IsIn(["ONLINE", "OFFLINE"]) declare availability: "ONLINE" | "OFFLINE";
}

/** تسجيل وثيقة بعد رفعها */
export class AddDocumentDto {
  @IsIn(DOC_TYPES) declare type: (typeof DOC_TYPES)[number];
  @IsString() declare url: string;
  /**
   * تاريخا الوثيقة كما يدخلهما السائق في شاشة الوثائق (ISO-8601).
   * اختياريان على مستوى الخادم؛ التطبيق هو من يفرضهما حسب النوع.
   */
  @IsOptional() @IsDateString() issuedAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}

/** طلب رابط رفع موقّع لوثيقة */
export class UploadUrlDto {
  @IsIn(DOC_TYPES) declare kind: (typeof DOC_TYPES)[number];
  @IsOptional() @IsString() contentType?: string;
}
