import { IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class RedeemLoyaltyDto {
  @IsInt()
  @Min(1)
  declare points: number;
}

export class AdjustLoyaltyDto {
  // موجب للإضافة، سالب للخصم (لا يُسمح بـ 0).
  @IsInt()
  declare points: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
