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
  target!: NotificationTarget;

  @IsEnum(NotificationChannel)
  @IsOptional()
  channel?: NotificationChannel;

  // مطلوب فقط عندما يكون الهدف USER
  @ValidateIf((o) => o.target === "USER")
  @IsString()
  userId?: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(1000)
  body!: string;

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
  token!: string;

  @IsString()
  platform!: string;
}
