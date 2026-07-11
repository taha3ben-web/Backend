import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PaymentStatus } from "@prisma/client";
import { PaymentsService } from "./payments.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  findAll(@Query() q: PaginationDto, @Query("status") status?: PaymentStatus) {
    return this.payments.findAll(q, status);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.payments.findOne(id);
  }


}
