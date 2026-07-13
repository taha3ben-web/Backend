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
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@Controller("documents")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermissions("drivers.documents", "drivers.manage")
  @Get()
  findAll(@Query() q: PaginationDto, @Query("status") status?: DocumentStatus) {
    return this.documents.findAll(q, status);
  }

  @RequirePermissions("drivers.documents", "drivers.manage")
  @Patch(":id/review")
  review(
    @Param("id") id: string,
    @Body() body: { status: "APPROVED" | "REJECTED"; note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.documents.review(id, body.status, user.userId, body.note);
  }
}
