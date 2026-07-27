import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { InvoicesService } from "./invoices.service";

@UseGuards(JwtAuthGuard)
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** فواتير المستخدم الحالي. */
  @Get("me")
  mine(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) {
    return this.invoices.mine(user.userId, q);
  }

  /** يُصدر فاتورة رحلة مكتملة أو يُرجع الموجودة. */
  @Post("trip/:tripId")
  issue(
    @CurrentUser() user: AuthUser,
    @Param("tripId", ParseUUIDPipe) tripId: string,
  ) {
    return this.invoices.issueForTrip(tripId, user.userId);
  }

  /** تنزيل الفاتورة بصيغة PDF. */
  @Get(":id/pdf")
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.invoices.pdf(user.userId, id);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`,
    );
    res.setHeader("Content-Length", file.buffer.length);
    res.end(file.buffer);
  }
}
