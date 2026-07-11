import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ComplaintStatus, TicketStatus } from "@prisma/client";

// ---------- الدعم الفني ----------

export class CreateTicketDto {
  @IsString()
  @MaxLength(200)
  declare subject: string;

  @IsString()
  @IsOptional()
  category?: string;

  // أول رسالة في التذكرة
  @IsString()
  @MaxLength(2000)
  declare message: string;
}

export class AddTicketMessageDto {
  @IsString()
  @MaxLength(2000)
  declare body: string;
}

export class UpdateTicketStatusDto {
  @IsEnum(TicketStatus)
  declare status: TicketStatus;
}

// ---------- الشكاوى ----------

export class CreateComplaintDto {
  @IsString()
  @IsOptional()
  tripId?: string;

  @IsString()
  @IsOptional()
  againstUserId?: string;

  @IsString()
  @MaxLength(2000)
  declare message: string;
}

export class UpdateComplaintStatusDto {
  @IsEnum(ComplaintStatus)
  declare status: ComplaintStatus;
}

// ---------- التقييمات ----------

export class CreateRatingDto {
  @IsString()
  declare tripId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  declare stars: number;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  comment?: string;
}
