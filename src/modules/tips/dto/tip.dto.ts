import { IsNumber, IsOptional, IsString, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";
import { TIP_NOTE_MAX_LENGTH } from "../tips.util";

export class SendTipDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(TIP_NOTE_MAX_LENGTH)
  note?: string;
}
