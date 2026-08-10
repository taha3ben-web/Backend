import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { RIDE_CLASSES } from "./driver-self.dto";

export class ReviewVehicleDto {
  @IsIn(["APPROVED", "REJECTED"])
  status!: "APPROVED" | "REJECTED";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * يضبطها الإداري هنا فقط — السائق لم يعد يقدر يغيّر فئته عبر PATCH
   * /driver/me. اختياريان: تركهما فارغين يبقي فئة المركبة كما هي.
   */
  @IsOptional()
  @IsIn(RIDE_CLASSES)
  rideClass?: (typeof RIDE_CLASSES)[number];

  @IsOptional()
  @IsString()
  vehicleTypeId?: string;
}
