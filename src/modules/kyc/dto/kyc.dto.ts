import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { IdentityDocType } from "@prisma/client";

/** تقديم طلب تحقق هوية (الروابط تُرفع مسبقًا عبر التخزين ثم تُرسل هنا). */
export class SubmitKycDto {
  @IsEnum(IdentityDocType)
  declare docType: IdentityDocType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  docNumber?: string;

  @IsString()
  @MaxLength(1000)
  declare frontUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  backUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  selfieUrl?: string;
}

/** مراجعة إدارية: ملاحظة اختيارية + مدة صلاحية (للموافقة فقط). */
export class ReviewKycDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}
