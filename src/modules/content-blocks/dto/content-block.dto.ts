import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { ContentAudience, ContentBlockType } from "@prisma/client";
import { PaginationDto } from "../../../common/dto/pagination.dto";

export class CreateContentBlockDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  declare slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsOptional()
  @IsEnum(ContentBlockType)
  type?: ContentBlockType;

  @IsOptional()
  @IsEnum(ContentAudience)
  audience?: ContentAudience;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  declare body: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ctaUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** slug/locale/audience هوية ثابتة لا تُعدّل بعد الإنشاء. */
export class UpdateContentBlockDto {
  @IsOptional()
  @IsEnum(ContentBlockType)
  type?: ContentBlockType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ctaUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class QueryContentBlocksDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ContentBlockType)
  type?: ContentBlockType;

  @IsOptional()
  @IsEnum(ContentAudience)
  audience?: ContentAudience;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  // "true" / "false" — يُحلّل يدويًا في الخدمة.
  @IsOptional()
  @IsString()
  isActive?: string;
}

export class PublicContentQueryDto {
  @IsOptional()
  @IsEnum(ContentBlockType)
  type?: ContentBlockType;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;
}
