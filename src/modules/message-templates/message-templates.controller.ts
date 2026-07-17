import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { MessageTemplatesService } from "./message-templates.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import {
  CurrentUser,
  AuthUser,
} from "../../common/decorators/current-user.decorator";
import {
  CreateMessageTemplateDto,
  PreviewMessageTemplateDto,
  QueryMessageTemplatesDto,
  RenderMessageTemplateDto,
  UpdateMessageTemplateDto,
} from "./dto/message-templates.dto";

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles("STAFF")
@RequirePermissions("notifications.send")
@Controller("message-templates")
export class MessageTemplatesController {
  constructor(private readonly service: MessageTemplatesService) {}

  @Get()
  list(@Query() query: QueryMessageTemplatesDto) {
    return this.service.list(query);
  }

  @Post("preview")
  preview(@Body() dto: PreviewMessageTemplateDto) {
    return this.service.preview(dto);
  }

  @Post("render/:key")
  render(@Param("key") key: string, @Body() dto: RenderMessageTemplateDto) {
    return this.service.renderByKey(key, dto.locale, dto.vars ?? {});
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateMessageTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateMessageTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
