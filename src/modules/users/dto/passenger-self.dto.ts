import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

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
}

export class PassengerUploadUrlDto {
  @IsOptional()
  @IsString()
  contentType?: string;
}
