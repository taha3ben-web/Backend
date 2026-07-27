import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
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
/**
 * قناة التحقق من الهاتف المُفعّلة.
 *
 * `firebase` (الافتراضي): التطبيق يتحقق عبر Firebase Phone Auth ثم يُرسل
 * رمز ID إلى `POST /auth/firebase`، فلا داعي لبوابة SMS ولا لرموز محلية.
 * `sms`: مسار OTP المحلي (يتطلب بوابة SMS مضبوطة فعلًا).
 */
export type OtpChannel = "firebase" | "sms";

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly cfg: OtpConfig = parseOtpConfig(process.env);
  private readonly pepper: string;
  /** القناة المُفعّلة — الافتراضي Firebase Phone Auth. */
  private readonly channel: OtpChannel =
    (process.env.AUTH_OTP_CHANNEL ?? "").trim().toLowerCase() === "sms"
      ? "sms"
      : "firebase";
  /** في التطوير فقط: يُسجّل الرمز في اللوغ بدل إرساله. ممنوع في الإنتاج. */
  private readonly devMode =
    process.env.NODE_ENV !== "production" &&
    (process.env.OTP_DEV_MODE ?? "").trim().toLowerCase() === "true";

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
    // مع Firebase Phone Auth لا يجوز أن يولّد الخادم رمزًا لن يُرسل أبدًا،
    // لأن ذلك يترك المستخدم أمام شاشة إدخال رمز لا وجود له (فشل صامت).
    if (this.channel !== "sms") {
      throw new BadRequestException(
        "التحقق عبر OTP المحلي معطّل. استخدم Firebase Phone Auth ثم POST /auth/firebase",
      );
    }
    if (!this.sms.isConfigured && !this.devMode) {
      throw new ServiceUnavailableException("بوابة SMS غير مضبوطة على الخادم");
    }

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
    if (!this.sms.isConfigured && this.devMode) {
      // وضع التطوير فقط: لا بوابة، فيُسجّل الرمز محليًا للاختبار.
      this.logger.warn(`OTP_DEV_MODE — رمز ${identifier}: ${code}`);
      return { sent: true, expiresInSeconds: this.cfg.ttlSec };
    }

    // إرسال حقيقي: لا يُرجع `sent: true` إلا إن قبلت البوابة الرسالة فعلًا.
    // الإبلاغ عن نجاح وهمي يترك المستخدم عالقًا ينتظر رمزًا لن يأتي.
    let delivered = 0;
    try {
      delivered = await this.sms.send({
        phones: [identifier],
        body: this.buildMessage(code),
      });
    } catch (e) {
      this.logger.error(
        `فشل إرسال OTP عبر SMS: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (delivered === 0) {
      // لا نترك رمزًا مخزّنًا لا يملكه أحد.
      await this.redis.client.del(otpKey(purpose, identifier));
      throw new ServiceUnavailableException(
        "تعذر إرسال رمز التحقق — حاول لاحقًا",
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
    return `flaminGO: رمز التحقق الخاص بك هو ${code}، صالح لمدة ${minutes} دقيقة. لا تشاركه مع أحد.`;
  }
}
