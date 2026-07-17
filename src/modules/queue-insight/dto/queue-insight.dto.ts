import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/** حدّ عناصر تفصيل التراكم حسب اسم الحدث. */
export class BacklogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** تنظيف سجلات DELIVERED الأقدم من المدّة المحدّدة (بالأيام). */
export class PurgeDeliveredDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  olderThanDays?: number;
}

/** إعادة جدولة دفعة من رسائل DLQ. */
export class RetryAllDeadLettersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
