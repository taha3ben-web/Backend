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
import { TicketStatus } from "@prisma/client";
import { SupportService } from "./support.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  AddTicketMessageDto,
  CreateTicketDto,
  UpdateTicketStatusDto,
} from "./dto/support.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("support/tickets")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** فتح تذكرة دعم */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(user.userId, dto);
  }

  /** تذاكر المستخدم الحالي */
  @Get("me")
  mine(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.support.myTickets(user.userId, q);
  }

  /** كل التذاكر (الدعم) */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get()
  all(@Query() q: PaginationDto, @Query("status") status?: TicketStatus) {
    return this.support.allTickets(q, status);
  }

  /** تفاصيل تذكرة مع المحادثة */
  @Get(":id")
  getOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.support.getTicket(id, user.userId, user.role === "STAFF");
  }

  /** إضافة رسالة (مستخدم أو دعم) */
  @Post(":id/messages")
  reply(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: AddTicketMessageDto,
  ) {
    return this.support.addMessage(id, user.userId, user.role === "STAFF", dto);
  }

  /** تغيير الحالة (حل/إغلاق) — الدعم فقط */
  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdateTicketStatusDto) {
    return this.support.updateStatus(id, dto.status);
  }
}
