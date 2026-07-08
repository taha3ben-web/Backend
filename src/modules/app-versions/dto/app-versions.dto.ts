import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateAppVersionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  platform!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  minSupported?: string;

  @IsOptional()
  @IsBoolean()
  forceUpdate?: boolean;

  @IsOptional()
  @IsString()
  url?: string;
}
