import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { RideClass } from "@prisma/client";

export class CreatePricingRuleDto {
  @IsString()
  @IsOptional()
  cityId?: string;

  /**
   * المرحلة 8: نطاق الولاية. الأولوية عند الحساب: مدينة > ولاية > وطني.
   * قاعدة بلا cityId وبلا wilayaId = قاعدة وطنية لكل الجزائر.
   */
  @IsString()
  @IsOptional()
  wilayaId?: string;

  @IsEnum(RideClass)
  @IsOptional()
  rideClass?: RideClass;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  declare baseFare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  declare perKm: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  declare perMin: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  declare minFare: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxFare?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdatePricingRuleDto {
  /** إعادة تحديد نطاق القاعدة جغرافيًا (المرحلة 8) */
  @IsString()
  @IsOptional()
  cityId?: string | null;

  @IsString()
  @IsOptional()
  wilayaId?: string | null;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  baseFare?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  perKm?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  perMin?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minFare?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxFare?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreatePeakPricingDto {
  @IsString()
  declare pricingRuleId: string;

  @IsString()
  declare name: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  declare multiplier: number;

  // HH:mm
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  declare startTime: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  declare endTime: string;

  // 0=الأحد ... 6=السبت
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  daysOfWeek?: number[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/**
 * سياسة رسوم الانتظار (المرحلة 7).
 * تُحفظ في Setting واحد (pricing.fees) وتُقرأ من PricingPolicyService.
 */
export class WaitingFeeDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  /** الدقائق المجانية قبل بدء الاحتساب (بالثواني). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  @IsOptional()
  freeSeconds?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  perMinute?: number;

  /** سقف رسوم الانتظار؛ null = بلا سقف. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxCharge?: number | null;
}

/** سياسة رسوم الإلغاء (المرحلة 7). */
export class CancellationFeeDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  /** نافذة إلغاء مجانية بعد قبول السائق (ثوانٍ). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3600)
  @IsOptional()
  graceSeconds?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  feeAfterAccept?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  feeAfterArrival?: number;

  /** نسبة الرسم التي تذهب للسائق كتعويض. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  driverCompensationPct?: number;
}

/**
 * تحديث رسوم الأجرة المركزية من اللوحة (المرحلة 7).
 *
 * هذه هي الواجهة التي ربطت رسوم الخدمة/الانتظار/الإلغاء بالنظام بعدما
 * كانت موجودة في الكود دون أي مستدعٍ.
 */
/** حدود التفاوض (المرحلة 7): عرض النطاق حول السعر المقترَح. */
export class NegotiationDto {
  /** 0.2 = ±20% حول السعر المقترَح؛ 0 = لا تفاوض. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.9)
  @IsOptional()
  bandPct?: number;
}

export class UpdatePricingFeesDto {
  /** رسوم خدمة ثابتة لكل رحلة (0 = معطّلة). */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  serviceFee?: number;

  @ValidateNested()
  @Type(() => WaitingFeeDto)
  @IsOptional()
  waiting?: WaitingFeeDto;

  @ValidateNested()
  @Type(() => CancellationFeeDto)
  @IsOptional()
  cancellation?: CancellationFeeDto;

  @ValidateNested()
  @Type(() => NegotiationDto)
  @IsOptional()
  negotiation?: NegotiationDto;
}
