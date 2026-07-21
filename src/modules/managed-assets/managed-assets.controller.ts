import {
  Body,
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
  Headers,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import { ManagedAssetsService } from "./managed-assets.service";
import {
  FinalizeManagedAssetDto,
  PrepareManagedAssetDto,
  UpdateManagedAssetDto,
} from "./dto/managed-assets.dto";
@Controller("managed-assets")
export class ManagedAssetsController {
  constructor(private service: ManagedAssetsService) {}
  private base(r: Request) {
    const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (configured) return configured;
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("PUBLIC_BASE_URL is required");
    }
    const protocol = String(r.headers["x-forwarded-proto"] ?? r.protocol).split(
      ",",
    )[0];
    return `${protocol}://${r.get("host")}`;
  }
  @Get("manifest/passenger")
  @Header("Cache-Control", "public,max-age=30,stale-while-revalidate=300")
  async manifest(
    @Req() r: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-none-match") known?: string,
  ) {
    const x = await this.service.manifest(this.base(r));
    res.setHeader("ETag", `"${x.etag}"`);
    if (known?.replace(/"/g, "") === x.etag) {
      res.status(304);
      return;
    }
    return x;
  }
  @Get("file/:key") async file(
    @Param("key") key: string,
    @Res() res: Response,
    @Headers("if-none-match") known?: string,
  ) {
    const f = await this.service.file(key);
    if (known?.replace(/"/g, "") === f.etag) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Content-Length", String(f.bytes));
    res.setHeader("ETag", `"${f.etag}"`);
    res.setHeader("Cache-Control", "public,max-age=31536000,immutable");
    f.stream.pipe(res);
  }
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  list() {
    return this.service.list();
  }
  @Post("prepare")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  prepare(@Body() d: PrepareManagedAssetDto) {
    return this.service.prepare(d);
  }
  @Post("finalize")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  finalize(@Body() d: FinalizeManagedAssetDto, @CurrentUser() u: AuthUser) {
    return this.service.finalize(d, u.userId);
  }
  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  update(
    @Param("id") id: string,
    @Body() d: UpdateManagedAssetDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.update(id, d, u.userId);
  }
}
