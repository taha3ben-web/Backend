import { IsOptional, IsString, Matches } from "class-validator";

export class LoginDto {
  @IsString()
  declare phone: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsString()
  declare password: string;
}
