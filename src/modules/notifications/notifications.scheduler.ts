import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { NotificationsService } from "./notifications.service";
import { DistributedLockService } from "../../common/infra/distributed-lock.service";

/**
 * جدولة الإشعارات: كل دقيقة يعالج الإشعارات المجدولة المستحقة.
 * (يستخدم @nestjs/schedule — طابور مدعوم بقاعدة البيانات)
 */
@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private running = false;

  constructor(
    private readonly cronLock: DistributedLockService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduled(): Promise<void> {
    // قفل موزّع: مع أكثر من نسخة تعمل يجب أن تنفّذ واحدة فقط كل دورة.
    await this.cronLock.runExclusive(
      "cron:notifications-due",
      () => this.handleScheduledTask(),
      55000,
    );
  }

  /** المنطق الفعلي للمهمة بعد الحصول على القفل. */
  async handleScheduledTask(): Promise<void> {
    if (this.running) return; // منع التداخل
    this.running = true;
    try {
      const count = await this.notifications.processDue();
      if (count > 0) {
        this.logger.log(`تمت معالجة ${count} إشعار مجدول`);
      }
    } finally {
      this.running = false;
    }
  }
}
