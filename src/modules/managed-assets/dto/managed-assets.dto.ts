import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
const K = [
  "VEHICLE",
  "ICON",
  "NOTIFICATION",
  "SERVICE",
  "WALLET",
  "PROFILE",
  "BRAND",
  "SPLASH",
  "OTHER",
] as const;
export class PrepareManagedAssetDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{1,119}$/) key!: string;
  @IsIn(K) kind!: (typeof K)[number];
  @IsOptional() @IsIn(["PASSENGER", "ALL"]) audience?: "PASSENGER" | "ALL";
  @IsString() @MaxLength(120) contentType!: string;
}
export class FinalizeManagedAssetDto extends PrepareManagedAssetDto {
  @IsString() @MaxLength(500) objectPath!: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) width?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) height?: number;
}
export class UpdateManagedAssetDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
