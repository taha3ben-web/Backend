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
import { WorkflowStatus } from "@prisma/client";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { ListQueryDto } from "../../common/dto/list-query.dto";
import { VehicleTypesService } from "./vehicle-types.service";
import {
  CreateVehicleTypeDto,
  UpdateVehicleTypeDto,
} from "./dto/vehicle-type.dto";
import { ReorderDto, SetStatusDto } from "./dto/vehicle-category.dto";
import { VehicleFieldsService } from "./vehicle-fields.service";
import { RequirementsService } from "./requirements.service";
import {
  CreateVehicleFieldDto,
  UpdateVehicleFieldDto,
} from "./dto/vehicle-field.dto";

@Controller("vehicle-types")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("pricing.manage")
export class VehicleTypesController {
  constructor(
    private readonly vehicleTypes: VehicleTypesService,
    private readonly fields: VehicleFieldsService,
    private readonly requirements: RequirementsService,
  ) {}

  @Get()
  findAll(@Query() query: ListQueryDto) {
    return this.vehicleTypes.findAll(query);
  }

  @Patch("reorder")
  reorder(@Body() dto: ReorderDto, @CurrentUser() user: AuthUser) {
    return this.vehicleTypes.reorder(dto, user?.userId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.vehicleTypes.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateVehicleTypeDto, @CurrentUser() user: AuthUser) {
    return this.vehicleTypes.create(dto, user?.userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateVehicleTypeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vehicleTypes.update(id, dto, user?.userId);
  }

  @Patch(":id/active")
  setActive(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vehicleTypes.setActive(id, isActive, user?.userId);
  }

  /** تغيير حالة دورة النشر (Draft/Pending/Published/Archived). */
  @Patch(":id/status")
  setStatus(
    @Param("id") id: string,
    @Body() dto: SetStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.vehicleTypes.setStatus(
      id,
      dto.status as WorkflowStatus,
      user?.userId,
    );
  }

  @Post(":id/restore")
  restore(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.vehicleTypes.restore(id, user?.userId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.vehicleTypes.remove(id, user?.userId);
  }

  // ---- الحقول الديناميكية (Dynamic Forms) ----

  @Get(":id/fields")
  listFields(@Param("id") id: string) {
    return this.fields.findAll(id);
  }

  @Post(":id/fields")
  createField(
    @Param("id") id: string,
    @Body() dto: CreateVehicleFieldDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fields.create({ ...dto, vehicleTypeId: id }, user?.userId);
  }

  @Patch("fields/:fieldId")
  updateField(
    @Param("fieldId") fieldId: string,
    @Body() dto: UpdateVehicleFieldDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fields.update(fieldId, dto, user?.userId);
  }

  @Delete("fields/:fieldId")
  removeField(
    @Param("fieldId") fieldId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fields.remove(fieldId, user?.userId);
  }

  // ---- التحقق من المتطلبات ----

  @Get(":id/verify/:driverId")
  verify(@Param("id") id: string, @Param("driverId") driverId: string) {
    return this.requirements.verify(id, driverId);
  }
}
