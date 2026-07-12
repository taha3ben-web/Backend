import {
  IsEmail,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { UserStatus } from "@prisma/client";

// ---------- الأدوار ----------

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  declare name: string;

  @IsString()
  @IsOptional()
  description?: string;

  // مفاتيح الصلاحيات المربوطة بالدور
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissionKeys?: string[];
}

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  permissionKeys?: string[];
}

// ---------- الصلاحيات ----------

export class CreatePermissionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  declare key: string;

  @IsString()
  @IsOptional()
  description?: string;
}

// ---------- الموظفون ----------

export class CreateStaffDto {
  @IsString()
  @MinLength(2)
  declare name: string;

  @IsString()
  @MinLength(3)
  @MaxLength(40)
  declare username: string;

  @IsString()
  @MinLength(6)
  declare phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(6)
  declare password: string;

  @IsString()
  declare roleId: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class AssignRoleDto {
  @IsString()
  declare roleId: string;
}

export class UpdateStaffProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UpdateStaffPasswordDto {
  @IsString()
  @MinLength(6)
  declare password: string;
}

export class UpdateStaffStatusDto {
  @IsEnum(UserStatus)
  declare status: UserStatus;
}

export class SetRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  declare permissionKeys: string[];
}
