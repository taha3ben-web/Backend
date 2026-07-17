import { Injectable, Logger } from "@nestjs/common";
import { AppException } from "../../common/api/app.exception";
import { GeoProviderService } from "./geo-provider.service";
import {
  AutocompleteDto,
  DirectionsDto,
  GeocodeDto,
  ReverseGeocodeDto,
} from "./dto/geo.dto";

/**
 * خدمة الخرائط والعناوين (موجّهة للتطبيق).
 * تفوّض للمزوّد المحلول من اللوحة، وتحوّل أخطاء المزوّد إلى GEO_PROVIDER_ERROR.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(private readonly providers: GeoProviderService) {}

  async autocomplete(dto: AutocompleteDto) {
    const { provider, ctx } = await this.providers.resolve();
    const limit = dto.limit ?? 8;
    try {
      const suggestions = await provider.autocomplete(
        dto.q,
        {
          lat: dto.lat,
          lng: dto.lng,
          country: dto.country ?? ctx.defaultCountry,
          limit,
        },
        ctx,
      );
      return { provider: ctx.provider, suggestions };
    } catch (err) {
      throw this.toProviderError(err, "autocomplete");
    }
  }

  async geocode(dto: GeocodeDto) {
    const { provider, ctx } = await this.providers.resolve();
    try {
      const results = await provider.geocode(
        dto.q,
        { country: dto.country ?? ctx.defaultCountry },
        ctx,
      );
      return { provider: ctx.provider, results };
    } catch (err) {
      throw this.toProviderError(err, "geocode");
    }
  }

  async reverseGeocode(dto: ReverseGeocodeDto) {
    const { provider, ctx } = await this.providers.resolve();
    try {
      const result = await provider.reverseGeocode(
        { lat: dto.lat, lng: dto.lng },
        ctx,
      );
      return { provider: ctx.provider, result };
    } catch (err) {
      throw this.toProviderError(err, "reverseGeocode");
    }
  }

  async directions(dto: DirectionsDto) {
    const { provider, ctx } = await this.providers.resolve();
    try {
      const result = await provider.directions(
        { lat: dto.origin.lat, lng: dto.origin.lng },
        { lat: dto.destination.lat, lng: dto.destination.lng },
        (dto.waypoints ?? []).map((w) => ({ lat: w.lat, lng: w.lng })),
        ctx,
      );
      return result;
    } catch (err) {
      throw this.toProviderError(err, "directions");
    }
  }

  private toProviderError(err: unknown, op: string): AppException {
    this.logger.warn(`فشل عملية الخرائط (${op}): ${String(err)}`);
    return new AppException("GEO_PROVIDER_ERROR");
  }
}
