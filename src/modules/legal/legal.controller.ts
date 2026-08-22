import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { LegalService } from "./legal.service";
import {
  AcceptLegalDocumentDto,
  CreateLegalDocumentDto,
  UpdateLegalDocumentDto,
} from "./dto/legal.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";

@UseGuards(JwtAuthGuard)
@Controller("legal-documents")
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  // ----- مستخدم التطبيق (الموافقة) -----

  @Get("pending")
  pending(@CurrentUser() user: AuthUser, @Query("locale") locale?: string) {
    return this.legal.pendingForUser(
      {
        userId: user.userId,
        role: user.role,
      },
      locale,
    );
  }

  @Post(":id/accept")
  accept(
    @Param("id") id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AcceptLegalDocumentDto,
    @Ip() ip: string,
    @Headers("user-agent") userAgent: string,
  ) {
    return this.legal.accept(
      id,
      { userId: user.userId, role: user.role },
      dto,
      { ip, userAgent },
    );
  }

  // ----- إدارة اللوحة (settings.manage) -----

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Get()
  findAll(
    @Query("type") type?: string,
    @Query("audience") audience?: string,
  ) {
    return this.legal.findAll({ type, audience });
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Get(":id/versions")
  versions(@Param("id") id: string) {
    return this.legal.listVersions(id);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.legal.findOne(id);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Post()
  create(@Body() dto: CreateLegalDocumentDto) {
    return this.legal.create(dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateLegalDocumentDto) {
    return this.legal.update(id, dto);
  }

  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles("STAFF")
  @RequirePermissions("settings.manage")
  @Post(":id/publish")
  publish(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.legal.publish(id, {
      userId: user.userId,
      role: user.role,
    });
  }
}
