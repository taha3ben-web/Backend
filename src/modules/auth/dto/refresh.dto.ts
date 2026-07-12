import { Type } from "class-transformer";
import { IsOptional, IsString, ValidateNested } from "class-validator";
import { DeviceContextDto } from "./device-context.dto";

export class RefreshDto {
  @IsString()
  declare refreshToken: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceContextDto)
  device?: DeviceContextDto;
}
