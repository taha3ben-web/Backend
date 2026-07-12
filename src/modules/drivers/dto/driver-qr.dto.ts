import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

export class DriverQrIssueDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
