import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * قاعدة تسعير مرنة. يمكن إنشاء أكثر من قاعدة لنفس النوع،
 * تختلف حسب المنطقة/المدينة/الوقت/نوع العميل/العروض...
 */
export class CreateVehiclePricingRuleDto {
  @IsString() @IsNotEmpty() declare vehicleTypeId: string;
  @IsOptional() @IsString() name?: string;

  // النطاق الجغرافي
  @IsOptional() @IsString() serviceAreaId?: string;
  @IsOptional() @IsString() cityId?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;

  // نوع العميل والعروض
  @IsOptional() @IsString() customerType?: string;
  @IsOptional() @IsString() couponCode?: string;

  // النافذة الزمنية / المناسبات / الذروة
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) daysOfWeek?: number[];
  @IsOptional() @Matches(HHMM, { message: "startTime بصيغة HH:MM" }) startTime?: string;
  @IsOptional() @Matches(HHMM, { message: "endTime بصيغة HH:MM" }) endTime?: string;
  @IsOptional() @IsNumber() @Min(0) peakMultiplier?: number;

  // القيم
  @IsNumber() @Min(0) declare baseFare: number;
  @IsNumber() @Min(0) declare perKm: number;
  @IsNumber() @Min(0) declare perMin: number;
  @IsNumber() @Min(0) declare minFare: number;
  @IsOptional() @IsNumber() @Min(0) maxFare?: number;
  @IsOptional() @IsNumber() @Min(0) negotiationMin?: number;
  @IsOptional() @IsNumber() @Min(0) negotiationMax?: number;
  @IsOptional() @IsNumber() @Min(0) commissionPct?: number;
  @IsOptional() @IsString() currency?: string;

  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** تحديث قاعدة تسعير (كل الحقول اختيارية). */
export class UpdateVehiclePricingRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() serviceAreaId?: string;
  @IsOptional() @IsString() cityId?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() customerType?: string;
  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) daysOfWeek?: number[];
  @IsOptional() @Matches(HHMM) startTime?: string;
  @IsOptional() @Matches(HHMM) endTime?: string;
  @IsOptional() @IsNumber() @Min(0) peakMultiplier?: number;
  @IsOptional() @IsNumber() @Min(0) baseFare?: number;
  @IsOptional() @IsNumber() @Min(0) perKm?: number;
  @IsOptional() @IsNumber() @Min(0) perMin?: number;
  @IsOptional() @IsNumber() @Min(0) minFare?: number;
  @IsOptional() @IsNumber() @Min(0) maxFare?: number;
  @IsOptional() @IsNumber() @Min(0) negotiationMin?: number;
  @IsOptional() @IsNumber() @Min(0) negotiationMax?: number;
  @IsOptional() @IsNumber() @Min(0) commissionPct?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() priority?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
