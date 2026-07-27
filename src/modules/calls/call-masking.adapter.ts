/**
 * طبقة إخفاء أرقام الهواتف (Call Masking).
 *
 * المبدأ: الرقم لا يُحجب فقط، بل **يُستبدل**. لا أحد يتصل بالآخر مباشرة؛
 * كلاهما يتصل برقم وسيط تملكه المنصة، والمنصة تحوّل المكالمة داخليًا.
 *
 * ملف نقي تمامًا (بلا Nest ولا Prisma) ليكون قابلاً لاختبارات الوحدة،
 * ومبني بنفس نمط `PaymentAdapter` في المرحلة 2: واجهة واحدة ومحولات متعددة،
 * فيُفعّل مزوّد حقيقي لاحقًا بتغيير متغير بيئة واحد دون لمس منطق الرحلات.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type CallMaskingProvider = "chat_only" | "direct" | "twilio";

export type CallerRole = "PASSENGER" | "DRIVER";

export interface MaskedCallRequest {
  tripId: string;
  callerRole: CallerRole;
  /** رقم المتصل الحقيقي (لا يُعاد أبدًا إلى الطرف الآخر). */
  callerPhone: string;
  /** رقم المتلقي الحقيقي (لا يُعاد أبدًا إلى المتصل). */
  calleePhone: string;
  /** مدّة صلاحية الربط بالدقائق. */
  ttlMinutes: number;
}

export interface MaskedCallResult {
  provider: CallMaskingProvider;
  /** طريقة الاتصال المتاحة للعميل. */
  mode: "MASKED_NUMBER" | "DIRECT_NUMBER" | "CHAT_ONLY";
  /** الرقم الوسيط الذي يتصل به العميل (فقط في وضع MASKED_NUMBER). */
  proxyNumber?: string;
  /**
   * الرقم الحقيقي للطرف الآخر (فقط في وضع DIRECT_NUMBER).
   * يُملأ فقط حين تختار المنصة صراحةً الاتصال المباشر.
   */
  phoneNumber?: string;
  /** رمز اختياري يُطلب من المتصل (بعض المزوّدين يشاركون رقمًا واحدًا). */
  pin?: string;
  expiresAt: Date;
  /** رسالة تُعرض للمستخدم مباشرة. */
  message: string;
}

export interface CallMaskingAdapter {
  readonly name: CallMaskingProvider;
  /** هل المحول جاهز فعليًا (إعدادات مكتملة)؟ */
  isConfigured(): boolean;
  connect(request: MaskedCallRequest): Promise<MaskedCallResult>;
}

/**
 * حجز رقم وسيط لرحلة معينة.
 *
 * التخزين مسؤولية الخدمة (Prisma)، ويُمرّر للمحول كدالة حتّى يبقى هذا الملف نقيًا.
 */
export interface ProxyNumberAllocator {
  allocate(input: {
    request: MaskedCallRequest;
    provider: CallMaskingProvider;
    candidates: string[];
  }): Promise<{ proxyNumber: string; pin?: string; expiresAt: Date }>;
}

/**
 * يحجب الرقم مع إبقاء آخر خانتين للتمييز فقط (مثل: `+2136••••••47`).
 * دالة نقية: تُرجع `null` للمدخل الفارغ، ولا ترمي أبدًا.
 */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (trimmed.length <= 4) return "\u2022".repeat(trimmed.length);
  const head = trimmed.slice(0, 4);
  const tail = trimmed.slice(-2);
  const hidden = "\u2022".repeat(Math.max(2, trimmed.length - 6));
  return `${head}${hidden}${tail}`;
}

/** يقرأ المزوّد المطلوب من البيئة (دالة نقية). */
export function resolveProviderName(
  value?: string | null,
): CallMaskingProvider {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "twilio") return "twilio";
  if (raw === "direct" || raw === "raw" || raw === "plain") return "direct";
  return "chat_only";
}

/**
 * من يُسمح له برؤية الرقم الحقيقي في الوضع المباشر (دالة نقية).
 *
 * `both` (الافتراضي) ، `passenger` (الراكب فقط يرى رقم السائق) ، `driver`.
 * لاحقًا يمكن تضييق السياسة دون أي تعديل في منطق الرحلات.
 */
export function parseDirectCallRoles(value?: string | null): CallerRole[] {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "passenger") return ["PASSENGER"];
  if (raw === "driver") return ["DRIVER"];
  if (raw === "none") return [];
  return ["PASSENGER", "DRIVER"];
}

/** تطبيع رقم هاتف للمقارنة: أرقام فقط مع الإبقاء على علامة `+`. */
export function normalizePhone(phone?: string | null): string {
  if (!phone) return "";
  const raw = String(phone).trim();
  const digits = raw.replace(/[^0-9]/g, "");
  return raw.startsWith("+") ? `+${digits}` : digits;
}

/** هل الرقمان متطابقان بعد التطبيع؟ (مقارنة بآخر 9 خانات لتجاوز اختلاف المقدمة). */
export function samePhone(a?: string | null, b?: string | null): boolean {
  const x = normalizePhone(a).replace(/^\+/, "");
  const y = normalizePhone(b).replace(/^\+/, "");
  if (!x || !y) return false;
  if (x === y) return true;
  const tail = (v: string) => v.slice(-9);
  return tail(x).length === 9 && tail(x) === tail(y);
}

/** يهرّب محارف XML لبناء TwiML آمن (لا حقن عبر رقم ملغّم). */
export function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** TwiML: يحوّل المكالمة إلى الطرف الآخر مع إظهار الرقم الوسيط كمتصل. */
export function buildDialTwiml(input: {
  target: string;
  callerId: string;
  timeoutSec?: number;
  recordingEnabled?: boolean;
}): string {
  const timeout = Math.min(60, Math.max(10, input.timeoutSec ?? 30));
  const record = input.recordingEnabled ? ' record="record-from-answer"' : "";
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    "<Response>" +
    `<Dial callerId="${escapeXml(input.callerId)}" timeout="${timeout}"${record}>` +
    `<Number>${escapeXml(input.target)}</Number>` +
    "</Dial>" +
    "</Response>"
  );
}

/** TwiML: رفض مهذّب عندما لا يوجد ربط سارٍ (لا يُفشي أي معلومة). */
export function buildRejectTwiml(message: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    "<Response>" +
    `<Say language="arb">${escapeXml(message)}</Say>` +
    "<Hangup/>" +
    "</Response>"
  );
}

/**
 * يتحقق من توقيع Twilio (`X-Twilio-Signature`).
 *
 * الخوارزمية الموثّقة من Twilio: HMAC-SHA1 بمفتاح `authToken` على نصّ
 * (الرابط الكامل + كل حقل POST مرتّبًا أبجديًا كـ `key + value`)، ثم Base64.
 * المقارنة بـ `timingSafeEqual` لمنع هجوم توقيتي.
 */
export function verifyTwilioSignature(input: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature?: string | null;
}): boolean {
  if (!input.authToken || !input.signature) return false;
  const sorted = Object.keys(input.params ?? {}).sort();
  let data = input.url;
  for (const key of sorted) {
    data += key + String(input.params[key] ?? "");
  }
  const expected = createHmac("sha1", input.authToken)
    .update(Buffer.from(data, "utf8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(input.signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * المحول الافتراضي: لا مزوّد اتصالات، فالأرقام تُحجب تمامًا
 * والتواصل يجري عبر دردشة الرحلة الموجودة أصلاً (`TripMessage`).
 * هذا وضع أمين وصادق: لا يدّعي الاتصال ثم يفشل بصمت.
 */
export class ChatOnlyCallMaskingAdapter implements CallMaskingAdapter {
  readonly name: CallMaskingProvider = "chat_only";

  isConfigured(): boolean {
    return true;
  }

  async connect(request: MaskedCallRequest): Promise<MaskedCallResult> {
    return {
      provider: this.name,
      mode: "CHAT_ONLY",
      expiresAt: new Date(Date.now() + request.ttlMinutes * 60_000),
      message:
        "\u0627\u0644\u0645\u0643\u0627\u0644\u0645\u0627\u062a \u0627\u0644\u0647\u0627\u062a\u0641\u064a\u0629 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629 \u0628\u0639\u062f\u061b \u0627\u0633\u062a\u062e\u062f\u0645 \u062f\u0631\u062f\u0634\u0629 \u0627\u0644\u0631\u062d\u0644\u0629 \u0644\u0644\u062a\u0648\u0627\u0635\u0644 \u0645\u0639 \u0627\u0644\u0637\u0631\u0641 \u0627\u0644\u0622\u062e\u0631.",
    };
  }
}

/**
 * الوضع المباشر: يُعطي الرقم الحقيقي للطرف الآخر ليتصل به من هاتفه.
 *
 * لماذا موجود: الأرقام الوسيطة تكلف مالًا وتحتاج حسابًا جاهزًا؛ وفي الإقلاع
 * المبكر الأولوية أن يصل السائق للراكب. هذا المحول يُفعّل ذلك اليوم،
 * ويُستبدل لاحقًا بـ Twilio أو Vonage بتغيير `CALL_MASKING_PROVIDER` وحده.
 *
 * معلوم ومقبول بوعي: هنا **يُكشف الرقم**، ولا إخفاء فعليًا. لذلك
 * الكشف مقيد بالرحلات القائمة فقط (تتحقق منه الخدمة)، وقابل للتضييق
 * لدور واحد عبر `DIRECT_CALL_REVEAL`، وكل طلب يُسجل في `TripEvent`.
 */
export class DirectCallMaskingAdapter implements CallMaskingAdapter {
  readonly name: CallMaskingProvider = "direct";

  constructor(
    private readonly allowedRoles: CallerRole[] = ["PASSENGER", "DRIVER"],
  ) {}

  isConfigured(): boolean {
    return this.allowedRoles.length > 0;
  }

  async connect(request: MaskedCallRequest): Promise<MaskedCallResult> {
    const expiresAt = new Date(Date.now() + request.ttlMinutes * 60_000);
    if (!this.allowedRoles.includes(request.callerRole)) {
      // لا نرمي خطأ: نرجع للدردشة ليبقى للمستخدم مسار تواصل دائمًا.
      return {
        provider: this.name,
        mode: "CHAT_ONLY",
        expiresAt,
        message:
          "\u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0627\u0644\u0645\u0628\u0627\u0634\u0631 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d \u0644\u0643\u061b \u0627\u0633\u062a\u062e\u062f\u0645 \u062f\u0631\u062f\u0634\u0629 \u0627\u0644\u0631\u062d\u0644\u0629.",
      };
    }
    return {
      provider: this.name,
      mode: "DIRECT_NUMBER",
      phoneNumber: request.calleePhone,
      expiresAt,
      message:
        "\u064a\u0645\u0643\u0646\u0643 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0645\u0628\u0627\u0634\u0631\u0629\u064b \u0637\u0648\u0627\u0644 \u0627\u0644\u0631\u062d\u0644\u0629 \u0627\u0644\u0642\u0627\u0626\u0645\u0629.",
    };
  }
}

/**
 * محول Twilio الحقيقي.
 *
 * لا يتّصل بـ Twilio وقت الطلب إطلاقًا: يحجز رقمًا وسيطًا من أرقام المنصة
 * ويُعيده للتطبيق فورًا. حين يتصل المستخدم بذلك الرقم، يطرق Twilio
 * webhook المنصة فتردّ بـ TwiML يحوّل المكالمة للطرف الآخر.
 *
 * لماذا لا نستخدم Twilio Proxy API: أُوقف للمستخدمين الجدد، وهذا النمط
 * (رقم + رقم المتصل → وجهة) يعمل على أي حساب Voice عادي.
 */
export class TwilioCallMaskingAdapter implements CallMaskingAdapter {
  readonly name: CallMaskingProvider = "twilio";

  constructor(
    private readonly accountSid?: string,
    private readonly authToken?: string,
    private readonly proxyNumbers: string[] = [],
    private readonly allocator?: ProxyNumberAllocator,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.accountSid?.trim() &&
      this.authToken?.trim() &&
      this.proxyNumbers.length > 0 &&
      this.allocator,
    );
  }

  async connect(request: MaskedCallRequest): Promise<MaskedCallResult> {
    if (!this.isConfigured() || !this.allocator) {
      throw new Error("TWILIO_CALL_MASKING_NOT_CONFIGURED");
    }
    const { proxyNumber, pin, expiresAt } = await this.allocator.allocate({
      request,
      provider: this.name,
      candidates: this.proxyNumbers,
    });
    return {
      provider: this.name,
      mode: "MASKED_NUMBER",
      proxyNumber,
      pin,
      expiresAt,
      message:
        "\u0627\u062a\u0635\u0644 \u0628\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0645\u0639\u0631\u0648\u0636 \u0645\u0646 \u0631\u0642\u0645\u0643 \u0627\u0644\u0645\u0633\u062c\u0644 \u0641\u0642\u0637\u061b \u0633\u0646\u062d\u0648\u0651\u0644\u0643 \u0625\u0644\u0649 \u0627\u0644\u0637\u0631\u0641 \u0627\u0644\u0622\u062e\u0631 \u062f\u0648\u0646 \u0625\u0638\u0647\u0627\u0631 \u0631\u0642\u0645\u0647.",
    };
  }
}
