import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from "class-validator";

export class LoginDto {
  @ValidateIf((dto: LoginDto) => !dto.username)
  @IsString()
  phone?: string;

  @ValidateIf((dto: LoginDto) => !dto.phone)
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9._-]+$/)
  username?: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsString()
  declare password: string;
}
