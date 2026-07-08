import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

// ---------- الأدوار ----------

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

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
  key!: string;

  @IsString()
  @IsOptional()
  description?: string;
}

// ---------- الموظفون ----------

export class CreateStaffDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(6)
  phone!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  roleId!: string;
}

export class AssignRoleDto {
  @IsString()
  roleId!: string;
}

export class SetRolePermissionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionKeys!: string[];
}
