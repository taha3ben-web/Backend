import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { DeviceTokensService } from "./device-tokens.service";
import { PushProvider } from "./providers/push.provider";
import { SmsProvider } from "./providers/sms.provider";
import { EmailProvider } from "./providers/email.provider";

export interface DispatchInput {
  channel: NotificationChannel;
  userIds: string[];
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: string;
  data?: Record<string, unknown>;
}

/**
 * يوجّه الإشعار إلى القناة المناسبة (Push / SMS / Email / In-App).
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    // تبعية دائرية: RealtimeGateway ↔ TripsService/NotificationsService.
    // نؤجّل الحقن بـ forwardRef حتى لا يُقرأ النوع undefined وقت التحميل.
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
    private readonly deviceTokens: DeviceTokensService,
    private readonly push: PushProvider,
    private readonly sms: SmsProvider,
    private readonly email: EmailProvider,
  ) {}

  async dispatch(input: DispatchInput): Promise<number> {
    const { channel, userIds } = input;
    if (userIds.length === 0) return 0;

    switch (channel) {
      case "IN_APP":
        for (const userId of userIds) {
          this.realtime.emitToUser(userId, "notification", {
            title: input.title,
            body: input.body,
            imageUrl: input.imageUrl,
            deepLink: input.deepLink,
            data: input.data ?? {},
          });
        }
        return userIds.length;

      case "PUSH": {
        const tokens = await this.deviceTokens.tokensForUsers(userIds);
        return this.push.send({
          tokens,
          title: input.title,
          body: input.body,
          imageUrl: input.imageUrl,
          deepLink: input.deepLink,
          data: input.data,
        });
      }

      case "SMS": {
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { phone: true },
        });
        const phones = users.map((u) => u.phone).filter(Boolean);
        return this.sms.send({ phones, body: `${input.title}\n${input.body}` });
      }

      case "EMAIL": {
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIds }, email: { not: null } },
          select: { email: true, locale: true },
        });
        // نجمّع المستلمين بحسب اللغة حتى يُولّد القالب باتجاه صحيح لكل مجموعة.
        const byLocale = new Map<string, string[]>();
        for (const user of users) {
          if (!user.email) continue;
          const locale = user.locale || "ar";
          const bucket = byLocale.get(locale) ?? [];
          bucket.push(user.email);
          byLocale.set(locale, bucket);
        }
        let sent = 0;
        for (const [locale, emails] of byLocale) {
          sent += await this.email.sendTemplate({
            emails,
            template: "generic_notice",
            locale,
            vars: { title: input.title, body: input.body },
          });
        }
        return sent;
      }

      default:
        this.logger.warn(`قناة غير مدعومة: ${channel}`);
        return 0;
    }
  }
}
