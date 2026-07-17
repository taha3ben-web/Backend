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
import { FareOffersService } from "./fare-offers.service";
import { CreateFareOfferDto } from "./dto/fare-offer.dto";

/**
 * واجهة السائق للمزايدة ("/api/driver/fare-offers").
 * محمية بـ JWT + دور DRIVER؛ السائق يقدّم عرضًا مضادًا أو يسحب عرضه.
 */
@Controller("driver/fare-offers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("DRIVER")
export class FareOffersDriverController {
  constructor(private readonly service: FareOffersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFareOfferDto) {
    return this.service.createOffer(user.userId, dto);
  }

  @Get()
  listMine(
    @CurrentUser() user: AuthUser,
    @Query("limit") limit?: string,
  ) {
    return this.service.listDriverOffers(
      user.userId,
      limit ? Number(limit) : undefined,
    );
  }

  @Post(":id/withdraw")
  withdraw(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.withdrawOffer(user.userId, id);
  }
}
