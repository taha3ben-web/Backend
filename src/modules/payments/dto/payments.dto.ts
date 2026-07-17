import { Type } from "class-transformer";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { PaymentMethod, PaymentStatus } from "@prisma/client";

/** إنشاء/تهيئة دفعة أو جلسة Checkout لرحلة */
export class CreatePaymentCheckoutDto {
  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  provider?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  returnUrl?: string;

  @IsString()
  @IsOptional()
  cancelUrl?: string;
}

/** تسجيل دفعة لرحلة (للتوافق الخلفي) */
export class CreatePaymentDto {
  @IsString()
  declare tripId: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsString()
  @IsOptional()
  reference?: string;
}

/** تحديث حالة الدفعة */
export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus)
  declare status: PaymentStatus;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

/** تنفيذ إجراء تشغيلي على الدفعة */
export class PaymentActionDto {
  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

/** شحن محفظة راكب (top-up) */
export class WalletTopUpDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  declare amount: number;

  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsString()
  @IsOptional()
  reference?: string;
}

/** طلب سحب ينشئه السائق */
export class CreateWithdrawDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Min(1)
  declare amount: number;

  @IsString()
  @IsOptional()
  note?: string;

  /**
   * مفتاح عدم التكرار (idempotency) اختياري يرسله العميل (مثل UUID)
   * لمنع إنشاء طلب سحب مكرر عند إعادة المحاولة/ضعف الشبكة.
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  idempotencyKey?: string;
}

/** معالجة طلب السحب من المدير */
export class ProcessWithdrawDto {
  @IsString()
  @IsOptional()
  note?: string;
}
