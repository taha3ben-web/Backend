import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from "class-validator";

export enum RegisterRole {
  PASSENGER = "PASSENGER",
  DRIVER = "DRIVER",
}

export class RegisterDto {
  @IsString()
  declare name: string;

  @IsString()
  declare phone: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsString()
  @MinLength(6)
  declare password: string;

  @IsEnum(RegisterRole)
  declare role: RegisterRole;

  @IsOptional()
  @IsEmail()
  email?: string;
}
