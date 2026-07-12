import { Module } from "@nestjs/common";
import { AgentsService } from "./agents.service";
import { AgentsController } from "./agents.controller";
import { AgentSelfController } from "./agent-self.controller";

@Module({
  controllers: [AgentsController, AgentSelfController],
  providers: [AgentsService],
})
export class AgentsModule {}
