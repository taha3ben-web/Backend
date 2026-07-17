import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const LEGAL_TYPES = [
  "PRIVACY_POLICY",
  "TERMS_OF_SERVICE",
  "DRIVER_AGREEMENT",
  "COOKIE_POLICY",
  "REFUND_POLICY",
] as const;

const LEGAL_AUDIENCES = ["ALL", "PASSENGER", "DRIVER"] as const;

export class CreateLegalDocumentDto {
  @IsIn(LEGAL_TYPES)
  declare type: (typeof LEGAL_TYPES)[number];

  @IsOptional()
  @IsIn(LEGAL_AUDIENCES)
  audience?: (typeof LEGAL_AUDIENCES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  declare title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  declare body: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @IsOptional()
  @IsBoolean()
  requiresAcceptance?: boolean;

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}

export class UpdateLegalDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string | null;

  @IsOptional()
  @IsBoolean()
  requiresAcceptance?: boolean;

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AcceptLegalDocumentDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;
}
