import {
  IsEnum,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { NotificationChannel, NotificationTarget } from "@prisma/client";

export class SendNotificationDto {
  @IsEnum(NotificationTarget)
  declare target: NotificationTarget;

  @IsEnum(NotificationChannel)
  @IsOptional()
  channel?: NotificationChannel;

  // مطلوب فقط عندما يكون الهدف USER
  @ValidateIf((o) => o.target === "USER")
  @IsString()
  userId?: string;

  @IsString()
  @MaxLength(120)
  declare title: string;

  @IsString()
  @MaxLength(1000)
  declare body: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;

  // تاريخ الجدولة (ISO). إن أُهمل يُرسل فورًا
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
