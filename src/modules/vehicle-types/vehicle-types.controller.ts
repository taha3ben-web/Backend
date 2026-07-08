import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { VehicleTypesService } from "./vehicle-types.service";
import {
  CreateVehicleTypeDto,
  UpdateVehicleTypeDto,
} from "./dto/vehicle-type.dto";

@Controller("vehicle-types")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class VehicleTypesController {
  constructor(private readonly vehicleTypes: VehicleTypesService) {}

  @Get()
  findAll(@Query("activeOnly") activeOnly?: string) {
    return this.vehicleTypes.findAll(activeOnly === "true");
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.vehicleTypes.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateVehicleTypeDto) {
    return this.vehicleTypes.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateVehicleTypeDto) {
    return this.vehicleTypes.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.vehicleTypes.remove(id);
  }
}
