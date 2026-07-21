import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Gender } from "@prisma/client";

export class UpdatePassengerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(24)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  locale?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}

export class PassengerUploadUrlDto {
  @IsOptional()
  @IsString()
  contentType?: string;
}

export class RequestAccountDeletionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  confirmation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
