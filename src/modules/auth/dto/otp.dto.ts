import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/** غرض الرمز (يطابق OtpPurpose في otp.util). */
export enum OtpPurposeDto {
  PHONE_VERIFICATION = "PHONE_VERIFICATION",
  LOGIN = "LOGIN",
  PASSWORD_RESET = "PASSWORD_RESET",
}

export class RequestOtpDto {
  @IsString()
  declare phone: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @IsEnum(OtpPurposeDto)
  purpose?: OtpPurposeDto;
}

export class VerifyOtpDto {
  @IsString()
  declare phone: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsString()
  @MinLength(4)
  @MaxLength(8)
  declare code: string;

  @IsOptional()
  @IsEnum(OtpPurposeDto)
  purpose?: OtpPurposeDto;
}
