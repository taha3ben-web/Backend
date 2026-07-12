import { Type } from "class-transformer";
import { IsOptional, IsString, ValidateNested } from "class-validator";
import { DeviceContextDto } from "./device-context.dto";

export class LoginDto {
  @IsString()
  declare phone: string;

  @IsString()
  declare password: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceContextDto)
  device?: DeviceContextDto;
}
