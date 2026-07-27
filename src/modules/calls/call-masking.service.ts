import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  ChatOnlyCallMaskingAdapter,
  DirectCallMaskingAdapter,
  TwilioCallMaskingAdapter,
  maskPhone,
  parseDirectCallRoles,
  resolveProviderName,
  samePhone,
  type CallMaskingAdapter,
  type CallMaskingProvider,
  type CallerRole,
  type MaskedCallRequest,
  type MaskedCallResult,
  type ProxyNumberAllocator,
} from "./call-masking.adapter";

/** مدّة صلاحية ربط المكالمة بالدقائق. */
export const CALL_LINK_TTL_MIN = 60;
/** الحالات التي يُسمح فيها الاتصال بين الطرفين. */
export const CALLABLE_TRIP_STATUSES = [
  "ACCEPTED",
  "ARRIVED",
  "ARRIVING",
  "ONGOING",
  "IN_PROGRESS",
] as const;

export interface InboundRouting {
  sessionId: string;
  tripId: string;
  target: string;
  callerId: string;
}

/**
 * خدمة إخفاء الأرقام: تقرّر من يحق له الاتصال بمن، متى، وعبر أي مزوّد.
 *
 * الأرقام الحقيقية تُقرأ داخل الخادم فقط وتُمرّر للمحوّل؛ ولا تخرج في الاستجابة
 * إلا في الوضع المباشر (`direct`) المُعلن صراحةً. وكل طلب اتصال يُسجّل في
 * `TripEvent` لتتبّع الإساءات.
 */
@Injectable()
export class CallMaskingService implements ProxyNumberAllocator {
  private readonly logger = new Logger("CallMasking");
  private readonly adapters = new Map<
    CallMaskingProvider,
    CallMaskingAdapter
  >();
  private readonly provider = resolveProviderName(
    process.env.CALL_MASKING_PROVIDER,
  );

  constructor(private readonly prisma: PrismaService) {
    this.register(new ChatOnlyCallMaskingAdapter());
    this.register(
      new DirectCallMaskingAdapter(
        parseDirectCallRoles(process.env.DIRECT_CALL_REVEAL),
      ),
    );
    this.register(
      new TwilioCallMaskingAdapter(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
        (process.env.TWILIO_PROXY_NUMBERS ?? "")
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean),
        this,
      ),
    );
  }

  register(adapter: CallMaskingAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /** المحوّل الفعّال، مع الرجوع للدردشة إن كان المطلوب غير مضبوط. */
  activeAdapter(): CallMaskingAdapter {
    const wanted = this.adapters.get(this.provider);
    if (wanted?.isConfigured()) return wanted;
    if (this.provider !== "chat_only") {
      this.logger.warn(
        `مزوّد إخفاء الأرقام "${this.provider}" غير مضبوط — الرجوع إلى الدردشة فقط`,
      );
    }
    return this.adapters.get("chat_only") as CallMaskingAdapter;
  }

  /**
   * يطلب قناة اتصال لرحلة قائمة. يتحقّق من الملكية والحالة، ثم يفوّض للمحوّل الفعّال.
   */
  async connect(
    userId: string,
    tripId: string,
  ): Promise<MaskedCallResult & { callerRole: CallerRole }> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        status: true,
        passengerId: true,
        passenger: { select: { phone: true } },
        driver: { select: { userId: true, user: { select: { phone: true } } } },
      },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");

    const isPassenger = trip.passengerId === userId;
    const isDriver = trip.driver?.userId === userId;
    if (!isPassenger && !isDriver) {
      throw new ForbiddenException("ليست لديك صلاحية على هذه الرحلة");
    }
    if (
      !(CALLABLE_TRIP_STATUSES as readonly string[]).includes(
        String(trip.status),
      )
    ) {
      throw new BadRequestException("الاتصال متاح فقط أثناء رحلة قائمة");
    }

    const callerRole: CallerRole = isPassenger ? "PASSENGER" : "DRIVER";
    const callerPhone = isPassenger
      ? trip.passenger?.phone
      : trip.driver?.user?.phone;
    const calleePhone = isPassenger
      ? trip.driver?.user?.phone
      : trip.passenger?.phone;
    if (!callerPhone || !calleePhone) {
      throw new BadRequestException("رقم أحد الطرفين غير متوفر");
    }

    const adapter = this.activeAdapter();
    const result = await adapter.connect({
      tripId,
      callerRole,
      callerPhone,
      calleePhone,
      ttlMinutes: CALL_LINK_TTL_MIN,
    });

    // أثر دائم للمراجعة عند الشكاوى (بلا أرقام خام).
    await this.prisma.tripEvent
      .create({
        data: {
          tripId,
          type: "CALL_REQUESTED",
          actor: callerRole === "PASSENGER" ? "PASSENGER" : "DRIVER",
          meta: { provider: result.provider, mode: result.mode },
        },
      })
      .catch(() => undefined);

    return { ...result, callerRole };
  }

  /**
   * حجز رقم وسيط (تنفيذ `ProxyNumberAllocator`).
   *
   * القاعدة الحاكمة: الثنائية (رقم وسيط + رقم المتصل) يجب أن تدلّ على جلسة
   * سارية واحدة فقط، وإلا فلن يعرف الـ webhook إلى أين يحوّل. لذلك نرجّع جلسة
   * الرحلة نفسها إن وُجدت، وإلا نختار رقمًا غير مشغول لهذا المتصل.
   */
  async allocate(input: {
    request: MaskedCallRequest;
    provider: CallMaskingProvider;
    candidates: string[];
  }): Promise<{ proxyNumber: string; pin?: string; expiresAt: Date }> {
    const { request, provider, candidates } = input;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + request.ttlMinutes * 60_000);

    const existing = await this.prisma.callSession.findFirst({
      where: {
        tripId: request.tripId,
        callerRole: request.callerRole,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const extended = await this.prisma.callSession.update({
        where: { id: existing.id },
        data: { expiresAt },
      });
      return {
        proxyNumber: extended.proxyNumber,
        pin: extended.pin ?? undefined,
        expiresAt: extended.expiresAt,
      };
    }

    const busy = await this.prisma.callSession.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: now },
        proxyNumber: { in: candidates },
      },
      select: { proxyNumber: true, callerPhone: true },
    });

    const chosen = candidates.find(
      (num) =>
        !busy.some(
          (b) =>
            b.proxyNumber === num &&
            samePhone(b.callerPhone, request.callerPhone),
        ),
    );
    if (!chosen) {
      // لا نختار رقمًا ملتبسًا يوصل المتصل بشخص خاطئ.
      throw new BadRequestException("NO_PROXY_NUMBER_AVAILABLE");
    }

    const session = await this.prisma.callSession.create({
      data: {
        tripId: request.tripId,
        provider,
        proxyNumber: chosen,
        callerRole: request.callerRole,
        callerPhone: request.callerPhone,
        calleePhone: request.calleePhone,
        expiresAt,
      },
    });
    return { proxyNumber: session.proxyNumber, expiresAt: session.expiresAt };
  }

  /**
   * يحلّ مكالمة واردة: من (الرقم الوسيط المطلوب + رقم المتصل) إلى وجهة التحويل.
   * يُرجع `null` إن لم يوجد ربط سارٍ — ولا يُفشي السبب للمتصل.
   */
  async resolveInbound(
    proxyNumber: string,
    fromPhone: string,
  ): Promise<InboundRouting | null> {
    const now = new Date();
    const sessions = await this.prisma.callSession.findMany({
      where: { proxyNumber, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const match = sessions.find((s) => samePhone(s.callerPhone, fromPhone));
    if (!match) return null;

    await this.prisma.callSession
      .update({
        where: { id: match.id },
        data: { lastCallAt: now, callCount: { increment: 1 } },
      })
      .catch(() => undefined);

    await this.prisma.tripEvent
      .create({
        data: {
          tripId: match.tripId,
          type: "CALL_CONNECTED",
          actor: match.callerRole,
          meta: { provider: match.provider, sessionId: match.id },
        },
      })
      .catch(() => undefined);

    return {
      sessionId: match.id,
      tripId: match.tripId,
      target: match.calleePhone,
      callerId: match.proxyNumber,
    };
  }

  /** يُبطل كل روابط رحلة (يُستحسن عند انتهاء الرحلة أو شكوى إساءة). */
  async revokeForTrip(tripId: string): Promise<number> {
    const res = await this.prisma.callSession.updateMany({
      where: { tripId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  /** يعرض رقمًا محجوبًا للواجهات (للعرض فقط، لا للاتصال). */
  displayPhone(phone?: string | null): string | null {
    return maskPhone(phone);
  }
}
