import { Injectable, Logger } from "@nestjs/common";
import { FirebaseAdminService } from "../../auth/firebase-admin.service";
import { DeviceTokensService } from "../device-tokens.service";
import {
  FCM_MULTICAST_LIMIT,
  buildFcmData,
  chunk,
  isUnregisteredError,
} from "./fcm-payload.util";

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: string;
  data?: Record<string, unknown>;
}

/**
 * مزوّد الإشعارات الفورية (Push) عبر Firebase Cloud Messaging — HTTP v1 API.
 *
 * يعتمد على Firebase Admin SDK (نفس بيانات اعتماد firebase.* المستخدمة
 * لجسر الهوية)، فيسكّ توكن OAuth2 ويجدّده تلقائيًا ويستخدم v1 داخليًا.
 * (الـ Legacy HTTP API — fcm/send مع key= — أُغلق من قبل Google.)
 *
 * إن لم تُضبط بيانات اعتماد Firebase يُسجّل تحذيرًا ويتخطى (دون كسر النظام).
 */
@Injectable()
export class PushProvider {
  private readonly logger = new Logger(PushProvider.name);

  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly deviceTokens: DeviceTokensService,
  ) {}

  get isConfigured(): boolean {
    return this.firebase.isEnabled();
  }

  /**
   * يرسل على دفعات (FCM HTTP v1 يقبل حتى 500 توكن في sendEachForMulticast).
   * يعيد عدد الرسائل الناجحة، وينظّف التوكنات غير المسجّلة التي يرفضها FCM.
   */
  async send(msg: PushMessage): Promise<number> {
    if (msg.tokens.length === 0) return 0;

    const messaging = this.firebase.getMessaging();
    if (!messaging) {
      this.logger.warn(
        `Firebase غير مضبوط — تخطي إرسال Push إلى ${msg.tokens.length} جهاز`,
      );
      return 0;
    }

    const data = buildFcmData(msg.data, msg.deepLink);
    let sent = 0;
    const invalidTokens: string[] = [];

    for (const batch of chunk(msg.tokens, FCM_MULTICAST_LIMIT)) {
      try {
        const res = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: {
            title: msg.title,
            body: msg.body,
            ...(msg.imageUrl ? { imageUrl: msg.imageUrl } : {}),
          },
          ...(Object.keys(data).length ? { data } : {}),
        });
        sent += res.successCount;
        res.responses.forEach((r, i) => {
          if (r.success) return;
          if (isUnregisteredError(r.error?.code)) {
            invalidTokens.push(batch[i]);
          } else {
            this.logger.error(`FCM فشل توكن: ${r.error?.code ?? "unknown"}`);
          }
        });
      } catch (err) {
        this.logger.error(`FCM فشل الإرسال: ${(err as Error).message}`);
      }
    }

    // تنظيف التوكنات غير الصالحة (أجهزة أُلغي تثبيت التطبيق منها) —
    // ردّ v1 يعطي حالة كل توكن على حدة فنستغلّها لتقليص الضجيج.
    if (invalidTokens.length) {
      await this.deviceTokens.removeMany(invalidTokens);
      this.logger.log(
        `حذف ${invalidTokens.length} توكن غير صالح لم يعد مسجّلًا.`,
      );
    }

    return sent;
  }
}
