import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { MessageTemplateCategory, NotificationChannel } from "@prisma/client";
import { PaginationDto } from "../../../common/dto/pagination.dto";

export class CreateMessageTemplateDto {
  @IsString()
  @MaxLength(120)
  declare key: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsString()
  @MaxLength(160)
  declare name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(MessageTemplateCategory)
  category?: MessageTemplateCategory;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsString()
  @MaxLength(200)
  declare title: string;

  @IsString()
  @MaxLength(4000)
  declare body: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** المفتاح واللغة هوية ثابتة لا تُعدّل بعد الإنشاء. */
export class UpdateMessageTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(MessageTemplateCategory)
  category?: MessageTemplateCategory;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class PreviewMessageTemplateDto {
  @IsString()
  @MaxLength(200)
  declare title: string;

  @IsString()
  @MaxLength(4000)
  declare body: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;
}

export class RenderMessageTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;
}

export class QueryMessageTemplatesDto extends PaginationDto {
  @IsOptional()
  @IsEnum(MessageTemplateCategory)
  category?: MessageTemplateCategory;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  // "true" / "false" — يُحلّل يدويًا في الخدمة تجنّبًا لتحويل boolean الضمني الخاطئ.
  @IsOptional()
  @IsString()
  isActive?: string;
}
