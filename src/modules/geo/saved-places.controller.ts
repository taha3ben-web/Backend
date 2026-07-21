import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { SavedPlacesService } from "./saved-places.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import {
  CreateSavedPlaceDto,
  RecordRecentPlaceDto,
  UpdateSavedPlaceDto,
} from "./dto/geo.dto";

/**
 * أماكن المستخدم المحفوظة (موجّهة للتطبيق) تحت مسار geo/places.
 * كل مستخدم يدير أماكنه فقط.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("PASSENGER")
@Controller("geo/places")
export class SavedPlacesController {
  constructor(private readonly places: SavedPlacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.places.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSavedPlaceDto) {
    return this.places.create(user.userId, dto);
  }

  /** تسجيل مكان أخير (بعد بحث/رحلة). */
  @Post("recent")
  recordRecent(
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordRecentPlaceDto,
  ) {
    return this.places.recordRecent(user.userId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateSavedPlaceDto,
  ) {
    return this.places.update(user.userId, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.places.remove(user.userId, id);
  }
}
