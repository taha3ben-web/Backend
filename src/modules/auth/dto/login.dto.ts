import { IsString } from "class-validator";

export class LoginDto {
  @IsString()
  declare phone: string;

  @IsString()
  declare password: string;
}
