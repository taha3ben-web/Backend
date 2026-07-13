import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AgentStatus } from "@prisma/client";
import { AgentsService } from "./agents.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  AssignAgentRoleDto,
  CreateAgentDto,
  UpdateAgentDto,
  UpdateAgentPasswordDto,
} from "./dto/agents.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("agents.manage", "staff.manage")
@Controller("agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get("options")
  managementOptions() {
    return this.agents.managementOptions();
  }

  @Get()
  list(
    @Query() q: PaginationDto,
    @Query("status") status?: AgentStatus,
    @Query("cityId") cityId?: string,
  ) {
    return this.agents.listAgents(q, status, cityId);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.agents.getAgent(id);
  }

  @Get(":id/audit")
  auditTrail(@Param("id") id: string, @Query() q: PaginationDto) {
    return this.agents.auditTrail(id, q);
  }

  @Post()
  create(@Body() dto: CreateAgentDto, @CurrentUser() user: AuthUser) {
    return this.agents.createAgent(dto, user.userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.updateAgent(id, dto);
  }

  @Patch(":id/role")
  assignRole(@Param("id") id: string, @Body() dto: AssignAgentRoleDto) {
    return this.agents.assignRole(id, dto);
  }

  @Patch(":id/password")
  updatePassword(@Param("id") id: string, @Body() dto: UpdateAgentPasswordDto) {
    return this.agents.updatePassword(id, dto);
  }
}
