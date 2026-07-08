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
import { ComplaintStatus } from "@prisma/client";
import { ComplaintsService } from "./complaints.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import {
  CreateComplaintDto,
  UpdateComplaintStatusDto,
} from "./dto/support.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("support/complaints")
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  /** تقديم شكوى (أي مستخدم) */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateComplaintDto) {
    return this.complaints.create(user.userId, dto);
  }

  // ---------- إدارة (STAFF) ----------

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get()
  findAll(
    @Query() q: PaginationDto,
    @Query("status") status?: ComplaintStatus,
  ) {
    return this.complaints.findAll(q, status);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.complaints.findOne(id);
  }

  @UseGuards(RolesGuard)
  @Roles("STAFF")
  @Patch(":id/status")
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateComplaintStatusDto,
  ) {
    return this.complaints.updateStatus(id, dto.status, user.userId);
  }
}
