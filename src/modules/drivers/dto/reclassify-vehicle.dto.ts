import { IsIn, IsOptional, IsString } from "class-validator";
import { RIDE_CLASSES } from "./driver-self.dto";

/** PATCH /vehicles/:id/reclassify — تصحيح فئة/نوع مركبة معتمدة مسبقًا. */
export class ReclassifyVehicleDto {
  @IsOptional()
  @IsIn(RIDE_CLASSES)
  rideClass?: (typeof RIDE_CLASSES)[number];

  @IsOptional()
  @IsString()
  vehicleTypeId?: string;
}
