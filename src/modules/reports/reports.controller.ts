import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ReportsService } from "./reports.service";
import { ReportQueryDto, ReportType } from "./dto/reports.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * تنزيل تقرير بصيغة PDF أو Excel.
   * مثال: GET /api/reports/revenue?format=excel&from=2026-01-01&to=2026-02-01
   * الأنواع: revenue | trips | drivers | passengers | top-drivers | top-cities
   */
  @Get(":type")
  async download(
    @Param("type") type: ReportType,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.generate(
      type,
      { from: query.from, to: query.to },
      query.format,
      query.limit,
    );
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`,
    );
    res.setHeader("Content-Length", file.buffer.length);
    res.end(file.buffer);
  }
}
