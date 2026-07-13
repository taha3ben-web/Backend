import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { AgentStatus } from "@prisma/client";

export class CreateAgentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  declare name: string;

  @IsString()
  @MinLength(6)
  @MaxLength(40)
  declare phone: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  declare password: string;

  @IsString()
  @MinLength(3)
  @MaxLength(40)
  declare agentCode: string;

  @IsString()
  declare roleId: string;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  agentCode?: string;

  @IsOptional()
  @IsEnum(AgentStatus)
  status?: AgentStatus;

  @IsOptional()
  @IsString()
  cityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AssignAgentRoleDto {
  @IsString()
  declare roleId: string;
}

export class UpdateAgentPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  declare password: string;
}
