import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import {
  GrowthService,
  CreateIncentiveInput,
  CreateExperimentInput,
} from "./growth.service";

@Controller("growth")
@UseGuards(JwtAuthGuard, RolesGuard)
export class GrowthController {
  constructor(private readonly service: GrowthService) {}

  @Post("incentives")
  @Roles("STAFF")
  createIncentive(
    @Body() body: CreateIncentiveInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createIncentive(body, user.userId);
  }

  @Get("incentives")
  @Roles("STAFF")
  listIncentives(@Query("activeOnly") activeOnly?: string) {
    return this.service.listIncentives(activeOnly === "true");
  }

  @Post("incentives/:id/progress")
  @Roles("STAFF")
  recordProgress(
    @Param("id") id: string,
    @Body("driverId") driverId: string,
    @Body("stats") stats: Record<string, number>,
  ) {
    return this.service.recordProgress(id, driverId, stats);
  }

  @Post("experiments")
  @Roles("STAFF")
  createExperiment(
    @Body() body: CreateExperimentInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createExperiment(body, user.userId);
  }

  @Get("experiments")
  @Roles("STAFF")
  listExperiments() {
    return this.service.listExperiments();
  }

  @Get("experiments/:key/assignment")
  assign(@Param("key") key: string, @CurrentUser() user: AuthUser) {
    return this.service.assign(key, user.userId);
  }
}
