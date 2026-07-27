import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from "class-validator";
import { LostItemStatus } from "@prisma/client";

export class CreateLostItemDto {
  @IsUUID()
  tripId!: string;

  @IsString()
  @Length(3, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;
}

export class UpdateLostItemStatusDto {
  @IsEnum(LostItemStatus)
  status!: LostItemStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
