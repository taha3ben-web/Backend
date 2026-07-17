import { Type } from "class-transformer";
import { FeatureFlagPlatform } from "@prisma/client";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export class RolloutStageDto {
  @IsDateString()
  declare startsAt: string;

  @IsInt()
  @Min(0)
  @Max(100)
  declare percentage: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class CreateFeatureFlagDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(FEATURE_KEY_PATTERN)
  declare key: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(FeatureFlagPlatform)
  platform?: FeatureFlagPlatform;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  cityIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  countryCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  appIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  clientOs?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  audienceSegments?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RolloutStageDto)
  rolloutPlan?: RolloutStageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  minAppVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  maxAppVersion?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class UpdateFeatureFlagDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(FeatureFlagPlatform)
  platform?: FeatureFlagPlatform;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  cityIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  countryCodes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  appIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  clientOs?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  audienceSegments?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RolloutStageDto)
  rolloutPlan?: RolloutStageDto[] | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  minAppVersion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  maxAppVersion?: string | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class UpdateFeatureFlagControlDto {
  @IsOptional()
  @IsBoolean()
  globalKillSwitch?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  globalKillReason?: string | null;
}

export class PreviewFeatureFlagsDto {
  @IsOptional()
  @IsEnum(FeatureFlagPlatform)
  platform?: FeatureFlagPlatform;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientOs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  segments?: string[];
}
