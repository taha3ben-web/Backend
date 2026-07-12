import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, AuthUser } from "../../common/decorators/current-user.decorator";
import { AgentsService } from "./agents.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("AGENT")
@Controller("agents/me")
export class AgentSelfController {
  constructor(private readonly agents: AgentsService) {}

  @Get("profile")
  profile(@CurrentUser() user: AuthUser) {
    return this.agents.getOwnProfile(user.userId);
  }
}
