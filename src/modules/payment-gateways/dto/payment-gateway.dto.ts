import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** نافذة رصد صحّة الـ webhooks (بالساعات). */
export class WebhookHealthQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  windowHours?: number;
}

/** حدّ أحداث الدفع الأخيرة. */
export class RecentEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
