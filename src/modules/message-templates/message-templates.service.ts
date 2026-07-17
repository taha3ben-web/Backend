import { Injectable } from "@nestjs/common";
import { MessageTemplate, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppException } from "../../common/api/app.exception";
import {
  CreateMessageTemplateDto,
  PreviewMessageTemplateDto,
  QueryMessageTemplatesDto,
  UpdateMessageTemplateDto,
} from "./dto/message-templates.dto";
import {
  DEFAULT_TEMPLATE_LOCALE,
  normalizeLocale,
  renderMessage,
  resolveDeclaredVariables,
  validateTemplateSyntax,
  type RenderedMessage,
} from "./message-template.util";

/**
 * خدمة قوالب الرسائل: CRUD كامل تُدار من لوحة التحكم + تعبئة
 * القوالب بالمتغيّرات. لا تحتوي أي تسعير أو خصم (كل ذلك يُدار من اللوحة).
 */
@Injectable()
export class MessageTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: QueryMessageTemplatesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.MessageTemplateWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.locale) where.locale = normalizeLocale(query.locale);
    if (query.isActive === "true") where.isActive = true;
    if (query.isActive === "false") where.isActive = false;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { key: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.messageTemplate.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { key: "asc" }, { locale: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.messageTemplate.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<MessageTemplate> {
    const tpl = await this.prisma.messageTemplate.findUnique({ where: { id } });
    if (!tpl) throw new AppException("NOT_FOUND");
    return tpl;
  }

  private assertSyntax(title: string, body: string): void {
    const t = validateTemplateSyntax(title);
    const b = validateTemplateSyntax(body);
    if (!t.valid || !b.valid) {
      throw new AppException("VALIDATION_ERROR", {
        details: { title: t.errors, body: b.errors },
      });
    }
  }

  async create(
    dto: CreateMessageTemplateDto,
    userId?: string,
  ): Promise<MessageTemplate> {
    const key = dto.key.trim();
    const locale = normalizeLocale(dto.locale);
    this.assertSyntax(dto.title, dto.body);
    const exists = await this.prisma.messageTemplate.findUnique({
      where: { key_locale: { key, locale } },
    });
    if (exists) throw new AppException("CONFLICT");
    const variables = resolveDeclaredVariables(
      dto.title,
      dto.body,
      dto.variables,
    );
    return this.prisma.messageTemplate.create({
      data: {
        key,
        locale,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        category: dto.category ?? "TRANSACTIONAL",
        channel: dto.channel ?? null,
        title: dto.title,
        body: dto.body,
        variables,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
    });
  }

  async update(
    id: string,
    dto: UpdateMessageTemplateDto,
    userId?: string,
  ): Promise<MessageTemplate> {
    const current = await this.findOne(id);
    const title = dto.title ?? current.title;
    const body = dto.body ?? current.body;
    const touchesContent =
      dto.title != null || dto.body != null || dto.variables != null;
    if (dto.title != null || dto.body != null) {
      this.assertSyntax(title, body);
    }
    const variables = touchesContent
      ? resolveDeclaredVariables(title, body, dto.variables ?? current.variables)
      : current.variables;
    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description?.trim() || null,
        category: dto.category,
        channel: dto.channel === undefined ? undefined : dto.channel ?? null,
        title: dto.title,
        body: dto.body,
        variables,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
        updatedById: userId ?? null,
      },
    });
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    await this.findOne(id);
    await this.prisma.messageTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** معاينة فورية (نقية، بلا قاعدة بيانات) لنص قالب مع قيم تجريبية. */
  preview(dto: PreviewMessageTemplateDto): RenderedMessage {
    return renderMessage(dto.title, dto.body, dto.vars ?? {});
  }

  /**
   * يعبّئ قالبًا مخزّنًا حسب المفتاح واللغة (مع رجوع إلى اللغة الافتراضية).
   * يُستعمل لاحقًا من وحدات أخرى (إشعارات، دعم) لبناء الرسائل.
   */
  async renderByKey(
    key: string,
    locale: string | undefined,
    vars: Record<string, unknown>,
  ) {
    const wanted = normalizeLocale(locale);
    let tpl = await this.prisma.messageTemplate.findUnique({
      where: { key_locale: { key, locale: wanted } },
    });
    if ((!tpl || !tpl.isActive) && wanted !== DEFAULT_TEMPLATE_LOCALE) {
      tpl = await this.prisma.messageTemplate.findUnique({
        where: { key_locale: { key, locale: DEFAULT_TEMPLATE_LOCALE } },
      });
    }
    if (!tpl || !tpl.isActive) throw new AppException("NOT_FOUND");
    const rendered = renderMessage(tpl.title, tpl.body, vars ?? {});
    return {
      key: tpl.key,
      locale: tpl.locale,
      channel: tpl.channel,
      title: rendered.title,
      body: rendered.body,
      missing: rendered.missing,
    };
  }
}
