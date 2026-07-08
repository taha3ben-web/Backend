import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export const RIDE_CLASSES = ["ECONOMY", "COMFORT", "VAN", "XL"] as const;
export const DOC_TYPES = [
  "LICENSE",
  "ID_CARD",
  "INSURANCE",
  "REGISTRATION",
  "PROFILE_PHOTO",
] as const;

/** تحديث ملف السائق ومركبته النشطة */
export class UpdateDriverProfileDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(60) carMake?: string;
  @IsOptional() @IsString() @MaxLength(60) carModel?: string;
  @IsOptional() @IsString() @MaxLength(30) carColor?: string;
  @IsOptional() @IsString() @MaxLength(20) carPlate?: string;
  @IsOptional() @IsInt() @Min(1970) carYear?: number;
  @IsOptional() @IsIn(RIDE_CLASSES) rideClass?: (typeof RIDE_CLASSES)[number];
  @IsOptional() @IsString() cityId?: string;
}

/** تبديل توفّر السائق (اتصال/قطع) */
export class SetAvailabilityDto {
  @IsIn(["ONLINE", "OFFLINE"]) availability!: "ONLINE" | "OFFLINE";
}

/** تسجيل وثيقة بعد رفعها */
export class AddDocumentDto {
  @IsIn(DOC_TYPES) type!: (typeof DOC_TYPES)[number];
  @IsString() url!: string;
}

/** طلب رابط رفع موقّع لوثيقة */
export class UploadUrlDto {
  @IsIn(DOC_TYPES) kind!: (typeof DOC_TYPES)[number];
  @IsOptional() @IsString() contentType?: string;
}
