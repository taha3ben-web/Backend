import { Type } from "class-transformer";
import { IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { DeviceContextDto } from "./device-context.dto";

export enum FirebaseRole {
  PASSENGER = "PASSENGER",
  DRIVER = "DRIVER",
}

/**
 * تبادل رمز Firebase ID بجلسة JWT خاصة بالخادم.
 */
export class FirebaseLoginDto {
  @IsString()
  declare idToken: string;

  @IsOptional()
  @IsEnum(FirebaseRole)
  role?: FirebaseRole;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceContextDto)
  device?: DeviceContextDto;
}
