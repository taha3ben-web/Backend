import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";
import { SmsProvider } from "../notifications/providers/sms.provider";
import { AppException } from "../../common/api/app.exception";
import {
  OtpConfig,
  OtpPurpose,
  parseOtpConfig,
  generateOtpCode,
  hashOtp,
  otpKey,
  otpRequestCountKey,
  otpVerifiedKey,
  serializeOtpRecord,
  parseOtpRecord,
  evaluateOtpVerification,
} from "./otp.util";

/**
 * خدمة OTP أصيلة (لا اعتماد على Firebase): توليد رمز رقمي، تخزين تجزئته
 * في Redis مع TTL، إرساله عبر SMS، ثم التحقق مع تقييد المحاولات ومعدّل الطلب.
 *
 * ملاحظة معمارية: نستخدم SmsProvider مباشرةً (يعتمد على ConfigService فقط)
 * ولا نستورد NotificationsModule لتجنّب التبعية الدائرية (Notifications يستورد Auth).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly cfg: OtpConfig = parseOtpConfig(process.env);
  private readonly pepper: string;

  constructor(
    private readonly redis: RedisService,
    private readonly sms: SmsProvider,
  ) {
    const configured = (process.env.OTP_PEPPER ?? "").trim();
    if (!configured) {
      this.logger.warn(
        "OTP_PEPPER غير مضبوط — يُستخدم مفتاح افتراضي؛ اضبطه في الإنتاج.",
      );
    }
    this.pepper = configured || "nova-ride-default-otp-pepper";
  }

  /**
   * يطلب رمزًا جديدًا لهوية (رقم هاتف مطبّق) وغرض. يطبّق تقييد معدّل
   * الطلب، ولا يكشف الرمز في الاستجابة أبدًا (يُرسل عبر SMS فقط).
   */
  async requestOtp(
    identifier: string,
    purpose: OtpPurpose,
  ): Promise<{ sent: boolean; expiresInSeconds: number }> {
    const countKey = otpRequestCountKey(purpose, identifier);
    const count = await this.redis.client.incr(countKey);
    if (count === 1) {
      await this.redis.client.expire(countKey, this.cfg.requestWindowSec);
    }
    if (count > this.cfg.maxRequestsPerWindow) {
      const ttl = await this.redis.client.ttl(countKey);
      throw new AppException("RATE_LIMITED", {
        details: {
          reason: "otp_request_throttled",
          retryAfterSeconds: ttl > 0 ? ttl : this.cfg.requestWindowSec,
        },
      });
    }

    const code = generateOtpCode(this.cfg.codeLength);
    const record = serializeOtpRecord({
      hash: hashOtp(code, identifier, this.pepper),
      attempts: 0,
    });
    await this.redis.client.set(
      otpKey(purpose, identifier),
      record,
      "EX",
      this.cfg.ttlSec,
    );

    // إرسال عبر SMS. مزوّد SMS لا يُطلق عادةً؛ نحيط احتياطًا ونسجّل دون إفشاء الرمز.
    try {
      await this.sms.send({ phones: [identifier], body: this.buildMessage(code) });
    } catch (e) {
      this.logger.error(
        `فشل إرسال OTP عبر SMS: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return { sent: true, expiresInSeconds: this.cfg.ttlSec };
  }

  /**
   * يتحقق من الرمز. عند النجاح يُبطل الرمز ويضع علامة تحقّق قصيرة
   * الأمد (10 دقائق) لتستهلكها تدفّقات لاحقة (مثل إكمال التسجيل).
   */
  async verifyOtp(
    identifier: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ verified: true }> {
    const key = otpKey(purpose, identifier);
    const record = parseOtpRecord(await this.redis.client.get(key));
    const providedHash = hashOtp(code, identifier, this.pepper);
    const outcome = evaluateOtpVerification(
      record,
      providedHash,
      this.cfg.maxVerifyAttempts,
    );

    switch (outcome.status) {
      case "not_found":
        throw new AppException("OTP_INVALID", {
          details: { reason: "expired_or_not_found" },
        });
      case "exhausted":
        await this.redis.client.del(key);
        throw new AppException("RATE_LIMITED", {
          details: { reason: "otp_attempts_exhausted" },
        });
      case "mismatch": {
        // تحديث عدّاد المحاولات مع الحفاظ على TTL المتبقّي (لا تمديد للصلاحية).
        const ttl = await this.redis.client.ttl(key);
        const updated = serializeOtpRecord({
          hash: record!.hash,
          attempts: outcome.nextAttempts,
        });
        if (ttl > 0) {
          await this.redis.client.set(key, updated, "EX", ttl);
        } else {
          await this.redis.client.set(key, updated);
        }
        throw new AppException("OTP_INVALID", {
          details: {
            reason: "mismatch",
            remainingAttempts: outcome.remainingAttempts,
          },
        });
      }
      case "match":
        await this.redis.client.del(key);
        await this.redis.client.set(
          otpVerifiedKey(purpose, identifier),
          "1",
          "EX",
          600,
        );
        return { verified: true };
    }

    // غير قابل للوصول (switch شامل) — حارس دفاعي.
    throw new AppException("OTP_INVALID", { details: { reason: "unknown" } });
  }

  /**
   * يتحقق (ويستهلك) علامة تحقّق الهاتف الحديثة. تستخدمها تدفّقات لاحقة.
   */
  async consumeVerifiedMarker(
    identifier: string,
    purpose: OtpPurpose,
  ): Promise<boolean> {
    const removed = await this.redis.client.del(
      otpVerifiedKey(purpose, identifier),
    );
    return removed > 0;
  }

  private buildMessage(code: string): string {
    const minutes = Math.max(1, Math.round(this.cfg.ttlSec / 60));
    return `NOVA Ride: رمز التحقق الخاص بك هو ${code}، صالح لمدة ${minutes} دقيقة. لا تشاركه مع أحد.`;
  }
}
