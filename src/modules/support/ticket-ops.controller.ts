import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { TicketOpsService } from "./ticket-ops.service";

@Controller("support/tickets")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class TicketOpsController {
  constructor(private readonly service: TicketOpsService) {}

  @Patch(":id/priority")
  setPriority(@Param("id") id: string, @Body("priority") priority: string) {
    return this.service.setPriority(id, priority);
  }

  @Patch(":id/assign")
  assign(
    @Param("id") id: string,
    @Body("assigneeId") assigneeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.assign(id, assigneeId || user.userId);
  }

  @Post(":id/first-response")
  firstResponse(@Param("id") id: string) {
    return this.service.markFirstResponse(id);
  }

  @Patch(":id/resolve")
  resolve(
    @Param("id") id: string,
    @Body("resolutionCode") resolutionCode: string,
  ) {
    return this.service.resolve(id, resolutionCode);
  }

  @Get("breaching")
  breaching() {
    return this.service.listBreaching();
  }
}
