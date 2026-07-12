import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationTarget,
} from "@prisma/client";
import { PaginationDto } from "../../../common/dto/pagination.dto";

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
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  body?: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;

  @IsISO8601()
  @IsOptional()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  templateKey?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class RegisterDeviceDto {
  @IsString()
  declare token: string;

  @IsString()
  declare platform: string;
}

export class ListNotificationsQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(NotificationTarget)
  target?: NotificationTarget;

  @IsOptional()
  @IsEnum(NotificationDeliveryStatus)
  status?: NotificationDeliveryStatus;

  @IsOptional()
  @IsString()
  templateKey?: string;
}

export class UpsertNotificationTemplateDto {
  @IsString()
  @MaxLength(120)
  declare key: string;

  @IsString()
  @MaxLength(120)
  declare name: string;

  @IsEnum(NotificationChannel)
  declare channel: NotificationChannel;

  @IsString()
  @MaxLength(120)
  declare titleTemplate: string;

  @IsString()
  @MaxLength(2000)
  declare bodyTemplate: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateNotificationTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bodyTemplate?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
