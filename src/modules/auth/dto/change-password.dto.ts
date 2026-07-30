import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  declare currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[a-z]/, { message: "New password must include a lowercase letter" })
  @Matches(/[A-Z]/, { message: "New password must include an uppercase letter" })
  @Matches(/[0-9]/, { message: "New password must include a number" })
  declare newPassword: string;

  @IsOptional()
  @IsBoolean()
  revokeOtherSessions?: boolean;
}
