import { Type } from "class-transformer";
import { IsOptional, IsString, ValidateNested } from "class-validator";
import { DeviceContextDto } from "./device-context.dto";

export class LoginDto {
  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  declare password: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceContextDto)
  device?: DeviceContextDto;
}
