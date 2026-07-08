import { Type } from "class-transformer";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from "class-validator";
import { PaymentMethod, PaymentStatus, WalletTxType } from "@prisma/client";

/** تسجيل دفعة لرحلة (عادة عند إنهاء الرحلة) */
export class CreatePaymentDto {
  @IsString()
  tripId!: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsString()
  @IsOptional()
  reference?: string;
}

/** تحديث حالة الدفعة (دفع/استرداد/فشل) */
export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus)
  status!: PaymentStatus;

  @IsString()
  @IsOptional()
  reference?: string;
}

/** تعديل رصيد المحفظة يدويًا من اللوحة (إضافة/خصم) */
export class WalletAdjustDto {
  @IsEnum(WalletTxType)
  type!: WalletTxType;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @IsOptional()
  reason?: string;
}

/** شحن محفظة راكب (top-up) */
export class WalletTopUpDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

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
  amount!: number;

  @IsString()
  @IsOptional()
  note?: string;
}

/** معالجة طلب السحب من المدير */
export class ProcessWithdrawDto {
  @IsString()
  @IsOptional()
  note?: string;
}
