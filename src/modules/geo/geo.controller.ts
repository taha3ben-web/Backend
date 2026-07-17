import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { GeoService } from "./geo.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import {
  AutocompleteDto,
  DirectionsDto,
  GeocodeDto,
  ReverseGeocodeDto,
} from "./dto/geo.dto";

/**
 * واجهات الخرائط والعناوين للتطبيق (راكب/سائق).
 * المزوّد يُحلّ خلف الباكند، ولا تمرّ أي مفاتيح إلى العميل.
 */
@UseGuards(JwtAuthGuard)
@Controller("geo")
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** إكمال تلقائي للعناوين. */
  @Get("autocomplete")
  autocomplete(@Query() query: AutocompleteDto) {
    return this.geo.autocomplete(query);
  }

  /** عنوان نصي ← إحداثيات. */
  @Get("geocode")
  geocode(@Query() query: GeocodeDto) {
    return this.geo.geocode(query);
  }

  /** إحداثيات ← عنوان نصي. */
  @Get("reverse")
  reverse(@Query() query: ReverseGeocodeDto) {
    return this.geo.reverseGeocode(query);
  }

  /** مسافة/زمن/مسار بين نقطتين. */
  @Post("directions")
  directions(@Body() dto: DirectionsDto) {
    return this.geo.directions(dto);
  }
}
