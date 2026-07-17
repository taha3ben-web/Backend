import { IsString, MaxLength, MinLength } from "class-validator";

export class ApplyReferralDto {
  @IsString()
  @MinLength(4)
  @MaxLength(32)
  declare code: string;
}
