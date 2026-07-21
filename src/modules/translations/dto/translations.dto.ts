import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";
export class UpsertTranslationBundleDto {
 @IsString() @Matches(/^[a-z]{2}(-[A-Z]{2})?$/) locale!: string;
 @IsObject() messages!: Record<string, unknown>;
 @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateTranslationBundleDto {
 @IsOptional() @IsObject() messages?: Record<string, unknown>;
 @IsOptional() @IsBoolean() isActive?: boolean;
}
