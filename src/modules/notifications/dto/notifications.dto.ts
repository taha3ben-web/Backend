import {
  IsBoolean,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";

export class MarkNotificationReadDto {
  @IsBoolean()
  read!: boolean;
}
import { NotificationChannel, NotificationTarget } from "@prisma/client";

export class SendNotificationDto {
  @IsEnum(NotificationTarget)
  declare target: NotificationTarget;

  @IsEnum(NotificationChannel)
  @IsOptional()
  channel?: NotificationChannel;

  @ValidateIf((o) => o.target === "USER")
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaignKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientOs?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  countryCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  localeCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  driverCityIds?: string[];

  @IsString()
  @MaxLength(120)
  declare title: string;

  @IsString()
  @MaxLength(1000)
  declare body: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deepLink?: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  scheduledAt?: string;
}

export class RegisterDeviceDto {
  @IsString()
  declare token: string;

  @IsString()
  declare platform: string;
}
