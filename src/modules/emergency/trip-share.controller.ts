import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Public } from "../../common/decorators/public.decorator";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { SHARE_MAX_TTL_MIN, TripShareService } from "./trip-share.service";

export class CreateTripShareDto {
  @IsString()
  declare tripId: string;

  /** مدّة صلاحية الرابط بالدقائق (5 — 720). */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(SHARE_MAX_TTL_MIN)
  ttlMinutes?: number;
}

@UseGuards(JwtAuthGuard)
@Controller("safety/share")
export class TripShareController {
  constructor(private readonly share: TripShareService) {}

  /** يُنشئ رابط متابعة مؤقّتًا (الرمز يُعاد مرّة واحدة فقط). */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTripShareDto) {
    return this.share.create(user.userId, dto.tripId, dto.ttlMinutes);
  }

  /** روابط المشاركة النشطة لرحلة. */
  @Get("trip/:tripId")
  list(@CurrentUser() user: AuthUser, @Param("tripId") tripId: string) {
    return this.share.listForTrip(user.userId, tripId);
  }

  /** إبطال رابط فورًا. */
  @Delete(":id")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.share.revoke(user.userId, id);
  }
}

/**
 * مسار عام منفصل: من يحمل الرمز يرى موقع الرحلة دون تسجيل دخول.
 * مفصول عن المتحكّم المحمي أعلاه حتّى لا يرث حارس المصادقة بالخطأ.
 */
@Controller("safety/share")
export class PublicTripShareController {
  constructor(private readonly share: TripShareService) {}

  @Public()
  @Get(":token")
  view(@Param("token") token: string) {
    return this.share.publicView(token);
  }
}
