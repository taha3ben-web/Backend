import { IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";

/**
 * شحن المحفظة.
 *
 * `method` هو **وسيلة الدفع** المستخدمة للشحن (بطاقة عبر بوابة، نقدًا عند
 * وكيل...)، وليس الرصيد المشحون. وسيلة الدفع ومزوّد الدفع مفهومان
 * منفصلان: `provider` اختياري ويسمح بتوجيه الشحن إلى بوابة معيّنة
 * (chargily اليوم، وVisa/Mastercard مستقبلًا) بلا تغيير في منطق المحفظة.
 */
export class CreateWalletTopUpDto {
  @IsNumber() @Min(0.01) amount!: number;

  /** وسيلة الدفع. WALLET غير مقبولة: لا يُشحن الرصيد من نفسه. */
  @IsOptional() @IsIn(["CARD", "CASH"]) method?: "CARD" | "CASH";

  /** مزوّد/بوابة محدّدة. اتركه فارغًا ليُختار المزوّد الافتراضي للوسيلة. */
  @IsOptional() @IsString() provider?: string;

  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() returnUrl?: string;
  @IsOptional() @IsString() cancelUrl?: string;

  /**
   * مفتاح الخمول من العميل. نقرة مكررة أو إعادة إرسال الطلب على شبكة
   * متقطّعة تُرجع نفس عملية الشحن بدل إنشاء ثانية.
   */
  @IsOptional() @IsString() idempotencyKey?: string;
}
