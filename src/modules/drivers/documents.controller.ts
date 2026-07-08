import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { DocumentStatus } from "@prisma/client";
import { DocumentsService } from "./documents.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@Controller("documents")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  findAll(@Query() q: PaginationDto, @Query("status") status?: DocumentStatus) {
    return this.documents.findAll(q, status);
  }

  @Patch(":id/review")
  review(
    @Param("id") id: string,
    @Body() body: { status: "APPROVED" | "REJECTED"; note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.documents.review(id, body.status, user.userId, body.note);
  }
}
