import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const APP_VERSION_STATUSES = ["ACTIVE", "PAUSED"] as const;

export class CreateAppVersionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  declare platform: string;

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
  @IsString()
  @MaxLength(40)
  releaseChannel?: string;

  @IsOptional()
  @IsIn(APP_VERSION_STATUSES)
  status?: (typeof APP_VERSION_STATUSES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare version: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  minSupported?: string;

  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  releaseNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  updateTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  updateMessage?: string;

  @IsOptional()
  @IsString()
  url?: string;
}

export class UpdateAppVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  appId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  clientOs?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  countryCodes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  releaseChannel?: string;

  @IsOptional()
  @IsIn(APP_VERSION_STATUSES)
  status?: (typeof APP_VERSION_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  minSupported?: string | null;

  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  releaseNotes?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  updateTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  updateMessage?: string | null;

  @IsOptional()
  @IsString()
  url?: string | null;
}

export class CheckAppVersionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  declare platform: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare version: string;

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
  releaseChannel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subjectId?: string;
}
