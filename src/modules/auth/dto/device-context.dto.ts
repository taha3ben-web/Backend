import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class DeviceContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  deviceKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  installationId?: string;

  @IsOptional()
  @IsBoolean()
  hardwareBacked?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appVersion?: string;
}
