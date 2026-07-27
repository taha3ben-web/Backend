import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { TripArchiveService } from "./trip-archive.service";

/**
 * تحكم يدوي بأرشفة الرحلات — للموظّفين فقط.
 *
 * الترتيب الموصى به: stats لمعرفة العدد، ثم run مع dryRun=true للتأكد،
 * ثم run فعليًا. لا يوجد مسار واحد يحذف كل شيء دفعة واحدة بقصد.
 */
@Controller("trips/archive")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("STAFF")
export class TripArchiveController {
  constructor(private readonly service: TripArchiveService) {}

  /** مقاييس الأرشيف: التاريخ الفاصل، المؤرشف فعلًا، والمنتظر. */
  @Get("stats")
  stats() {
    return this.service.stats();
  }

  /** يشغّل دفعة واحدة؛ dryRun=true يعدّ ولا يحذف شيئًا. */
  @Post("run")
  run(@Body("limit") limit?: number, @Body("dryRun") dryRun?: boolean) {
    return this.service.runOnce({
      limit: limit === undefined ? undefined : Number(limit),
      dryRun: dryRun === true,
    });
  }

  /** يقرأ النسخة الباردة لرحلة مؤرشفة (أحداثها ورسائلها المحفوظة). */
  @Get(":tripId")
  async snapshot(@Param("tripId", ParseUUIDPipe) tripId: string) {
    const archive = await this.service.snapshotFor(tripId);
    if (!archive) {
      throw new NotFoundException(
        "\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u0633\u062e\u0629 \u0623\u0631\u0634\u064a\u0641 \u0644\u0647\u0630\u0647 \u0627\u0644\u0631\u062d\u0644\u0629",
      );
    }
    return archive;
  }
}
