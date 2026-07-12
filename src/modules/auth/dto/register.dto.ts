import { Type } from "class-transformer";
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";
import { DeviceContextDto } from "./device-context.dto";

export enum RegisterRole {
  PASSENGER = "PASSENGER",
  DRIVER = "DRIVER",
}

export class RegisterDto {
  @IsString()
  declare name: string;

  @IsString()
  declare phone: string;

  @IsString()
  @MinLength(6)
  declare password: string;

  @IsEnum(RegisterRole)
  declare role: RegisterRole;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceContextDto)
  device?: DeviceContextDto;
}
