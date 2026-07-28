import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { RequireIdempotency } from "../../common/http/require-idempotency.decorator";
import { TipsService } from "./tips.service";
import { SendTipDto } from "./dto/tip.dto";

@UseGuards(JwtAuthGuard)
@Controller("tips")
export class TipsController {
  constructor(private readonly tips: TipsService) {}

  @Get("config")
  config() {
    return this.tips.config();
  }

  @Get("driver/summary")
  driverSummary(@CurrentUser() user: AuthUser) {
    return this.tips.driverSummary(user.userId);
  }

  @Get("trip/:tripId")
  forTrip(
    @CurrentUser() user: AuthUser,
    @Param("tripId", ParseUUIDPipe) tripId: string,
  ) {
    return this.tips.forTrip(user.userId, tripId);
  }

  @Post("trip/:tripId")
  @RequireIdempotency()
  send(
    @CurrentUser() user: AuthUser,
    @Param("tripId", ParseUUIDPipe) tripId: string,
    @Body() dto: SendTipDto,
  ) {
    return this.tips.send(user.userId, tripId, dto);
  }
}
