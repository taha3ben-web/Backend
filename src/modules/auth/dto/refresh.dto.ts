import { IsString } from "class-validator";

export class RefreshDto {
  @IsString()
  declare refreshToken: string;
}
