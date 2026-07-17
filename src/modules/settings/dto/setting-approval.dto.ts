import { IsOptional, IsString, MaxLength } from "class-validator";

export class ReviewSettingChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
