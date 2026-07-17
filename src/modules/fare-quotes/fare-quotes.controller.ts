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
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { FareQuotesService } from "./fare-quotes.service";
import { FareOffersService } from "./fare-offers.service";
import { CreateFareQuoteDto, ProposeFareDto } from "./dto/fare-quote.dto";

/**
 * واجهة الراكب لعرض السعر التفاوضي (مُصادَق عليه).
 * الراكب يطلب عرضًا (سعر مقترَح + نطاق) ثم يقترح سعره ضمن النطاق.
 */
@Controller("fare-quotes")
@UseGuards(JwtAuthGuard)
export class FareQuotesController {
  constructor(
    private readonly service: FareQuotesService,
    private readonly fareOffers: FareOffersService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFareQuoteDto) {
    return this.service.createQuote(user.userId, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthUser) {
    return this.service.listMine(user.userId);
  }

  @Get(":id")
  getOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.getOne(user.userId, id);
  }

  @Post(":id/propose")
  propose(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: ProposeFareDto,
  ) {
    return this.service.proposeFare(user.userId, id, dto.fare);
  }

  @Post(":id/cancel")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.service.cancel(user.userId, id);
  }

  // ---- عروض السائقين المضادة على عرض الراكب (مزايدة) ----

  @Get(":id/offers")
  listOffers(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.fareOffers.listQuoteOffers(user.userId, id);
  }

  @Post(":id/offers/:offerId/accept")
  acceptOffer(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("offerId") offerId: string,
  ) {
    return this.fareOffers.acceptOffer(user.userId, id, offerId);
  }

  @Post(":id/offers/:offerId/reject")
  rejectOffer(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("offerId") offerId: string,
  ) {
    return this.fareOffers.rejectOffer(user.userId, id, offerId);
  }
}
