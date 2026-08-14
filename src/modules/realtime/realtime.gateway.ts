import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Inject, forwardRef } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { TripStatus } from "@prisma/client";
import { RedisService } from "../redis/redis.service";
import { MatchingService } from "../matching/matching.service";
import { TripsService } from "../trips/trips.service";
import { MetricsService, WsRole } from "../metrics/metrics.service";
import {
  WsRateLimiter,
  WS_EVENT_LIMITS,
  DEFAULT_WS_LIMIT,
} from "./ws-rate-limiter";
import { resolveCorsOptions } from "../../common/security/cors-origins";

interface SocketUser {
  userId: string;
  role: string;
}

// إعدادات CORS للـ WebSocket — مصدر موحّد مع HTTP (resolveCorsOptions).
// في الإنتاج لا يُسمح بأصل مفتوح (*)؛ عند غياب القائمة يُرفض الاتصال العابر
// للأصول. في التطوير فقط يُسمح للجميع دون اعتمادات.
const WS_CORS = resolveCorsOptions(
  process.env.CORS_ORIGINS,
  process.env.NODE_ENV === "production",
);

// حدود إحداثيات صالحة (ترفض القيم المشوّهة/غير المنتهية).
function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * فاصل تقنين حفظ نقاط التتبّع في قاعدة البيانات (بالثواني) لكل رحلة.
 * السائق يبثّ موقعه كل 1–2 ثانية للعرض الحي، لكن نحفظ نقطة واحدة
 * كل TRACK_PERSIST_INTERVAL_SEC ثوانٍ فقط لبناء مسار الرحلة دون إغراق DB.
 */
const TRACK_PERSIST_INTERVAL_SEC = 4;

/**
 * WebSocket gateway:
 * - السائق يرسل موقعه (driver:location) كل 1–2 ثانية
 * - الراكب يستقبل (driver:moved) في غرفة رحلته
 * - المدير يستقبل كل التحركات في غرفة admins (خريطة حية)
 * - محرك المطابقة: عروض الرحلات (ride:offer) + رد السائق (ride:accept/decline)
 */
@WebSocketGateway({
  cors: { origin: WS_CORS.origin, credentials: WS_CORS.credentials },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() declare server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    @Inject(forwardRef(() => MatchingService))
    private readonly matching: MatchingService,
    @Inject(forwardRef(() => TripsService))
    private readonly trips: TripsService,
    private readonly metrics: MetricsService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    // مُقنّن معدّل الأحداث لكل اتصال (في الذاكرة — الاتصال ملتصق بنسخة واحدة).
    socket.data.rateLimiter = new WsRateLimiter();
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("missing token");
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>("jwt.accessSecret"),
      });
      const user: SocketUser = { userId: payload.sub, role: payload.role };
      socket.data.user = user;
      socket.join(`user:${user.userId}`);
      if (user.role === "STAFF") socket.join("admins");
      const wsRole = this.toWsRole(user.role);
      socket.data.wsRole = wsRole;
      socket.data.counted = true;
      this.metrics.incrWs(wsRole);
    } catch {
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    if (socket.data?.counted) {
      this.metrics.decrWs((socket.data.wsRole as WsRole) ?? "UNKNOWN");
      socket.data.counted = false;
    }
    // تنظيف موقع السائق من فهرس Redis الجغرافي عند القطع
    // (يمنع تراكم سائقين قدامى/غير متصلين وعروضًا لأشباح).
    const user: SocketUser | undefined = socket.data?.user;
    if (user?.role === "DRIVER") {
      try {
        await this.redis.removeDriverLocation(user.userId);
      } catch {
        // تجاهل — المفتاح ذو TTL وسينتهي تلقائيًا على أي حال.
      }
    }
  }

  private toWsRole(role: string): WsRole {
    return role === "PASSENGER" || role === "DRIVER" || role === "STAFF"
      ? role
      : "UNKNOWN";
  }

  /**
   * تقنين معدّل الأحداث لكل (socket, event) عبر دلو رموز في الذاكرة.
   * يمنع إغراق الخادم (DoS) بأحداث مثل driver:location أو ride:request.
   * لا يستخدم Redis لأن اتصال Socket.IO ملتصق بنسخة واحدة، فالعدّاد المحلي
   * كافٍ ويتجنّب جولة شبكة على المسار الساخن. يعيد true إذا سُمح بالحدث.
   */
  private allowEvent(socket: Socket, event: string): boolean {
    const limiter = socket.data.rateLimiter as WsRateLimiter | undefined;
    if (!limiter) return true; // fail-open إن غاب المُقنّن لأي سبب
    const cfg = WS_EVENT_LIMITS[event] ?? DEFAULT_WS_LIMIT;
    return limiter.tryConsume(event, cfg);
  }

  @SubscribeMessage("trip:join")
  async onTripJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tripId: string },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || !body?.tripId) return;
    if (!this.allowEvent(socket, "trip:join")) {
      socket.emit("ride:error", { message: "rate_limited" });
      return;
    }
    // تصريح: لا ينضم إلى غرفة الرحلة إلا طرفاها (الراكب أو السائق المكلّف).
    // يمنع تسرّب الموقع الحي وتحديثات الحالة (IDOR).
    if (user.role !== "STAFF") {
      const allowed = await this.trips.isParticipant(body.tripId, user.userId);
      if (!allowed) {
        socket.emit("ride:error", { message: "forbidden" });
        return;
      }
    }
    socket.join(`trip:${body.tripId}`);
  }

  @SubscribeMessage("driver:location")
  async onDriverLocation(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    body: { lat: number; lng: number; heading?: number; speed?: number },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "DRIVER") return;
    // تجاوز المعدّل → إسقاط صامت (لا نُرسل خطأ لتفادي حلقة تغذية راجعة).
    if (!this.allowEvent(socket, "driver:location")) return;
    if (!isValidLatLng(body?.lat, body?.lng)) return;

    await this.redis.setDriverLocation(
      user.userId,
      body.lat,
      body.lng,
      body.heading ?? 0,
    );

    // حالة الانشغال: السائق مرتبط برحلة نشطة في Redis (تُغذّي عدّاد
    // متاح/مشغول في خريطة المدير الحية).
    const tripId = await this.redis.client.get(`driver:${user.userId}:trip`);

    const payload = {
      driverId: user.userId,
      lat: body.lat,
      lng: body.lng,
      heading: body.heading ?? 0,
      speed: body.speed ?? 0,
      busy: !!tripId,
    };

    // خريطة المدير الحية
    this.server.to("admins").emit("driver:moved", payload);

    // راكب الرحلة النشطة (إن وجدت)
    if (tripId) {
      this.server
        .to(`trip:${tripId}`)
        .emit("driver:moved", { tripId, ...payload });

      // حفظ مسار الرحلة في TripTracking (مُقنّن لكل رحلة) لبناء سجلّ
      // المسار دون إغراق قاعدة البيانات بنقاط كل 1–2 ثانية.
      const gate = await this.redis.client.set(
        `trip:${tripId}:track_gate`,
        "1",
        "EX",
        TRACK_PERSIST_INTERVAL_SEC,
        "NX",
      );
      if (gate === "OK") {
        void this.trips.recordTracking(tripId, {
          lat: body.lat,
          lng: body.lng,
          heading: body.heading,
          speed: body.speed,
        });
      }
    }
  }

  /** الراكب يطلب رحلة عبر WebSocket (بديل للـ REST) */
  @SubscribeMessage("ride:request")
  async onRideRequest(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    body: {
      pickupLat: number;
      pickupLng: number;
      pickupAddress?: string;
      destLat: number;
      destLng: number;
      destAddress?: string;
      rideClass?: string;
      vehicleTypeId?: string;
      couponCode?: string;
      paymentMethod?: "CASH" | "CARD" | "WALLET";
      cityId?: string;
    },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "PASSENGER") return;
    if (!this.allowEvent(socket, "ride:request")) {
      socket.emit("ride:error", { message: "rate_limited" });
      return;
    }
    try {
      const trip = await this.matching.requestRide(user.userId, body as never);
      socket.join(`trip:${trip.id}`);
      socket.emit("ride:searching", { tripId: trip.id, fare: trip.fare });
    } catch (err) {
      socket.emit("ride:error", { message: (err as Error).message });
    }
  }

  /** السائق يقبل العرض */
  @SubscribeMessage("ride:accept")
  onRideAccept(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tripId: string },
  ): void {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "DRIVER") return;
    if (!this.allowEvent(socket, "ride:accept")) {
      socket.emit("ride:error", { message: "rate_limited" });
      return;
    }
    this.matching.respondToOffer(body.tripId, user.userId, true);
  }

  /** السائق يرفض العرض */
  @SubscribeMessage("ride:decline")
  onRideDecline(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tripId: string },
  ): void {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "DRIVER") return;
    if (!this.allowEvent(socket, "ride:decline")) {
      socket.emit("ride:error", { message: "rate_limited" });
      return;
    }
    this.matching.respondToOffer(body.tripId, user.userId, false);
  }

  /** الراكب يلغي الرحلة (أثناء البحث أو بعد القبول قبل بدء الرحلة) */
  @SubscribeMessage("ride:cancel")
  async onRideCancel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tripId: string; reason?: string },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "PASSENGER") return;
    if (!this.allowEvent(socket, "ride:cancel")) {
      socket.emit("ride:error", { message: "rate_limited" });
      return;
    }
    try {
      await this.matching.passengerCancel(
        user.userId,
        body.tripId,
        body.reason,
      );
    } catch (err) {
      socket.emit("ride:error", { message: (err as Error).message });
    }
  }

  /** السائق يحدّث حالة الرحلة (arriving/in_progress/completed/cancelled) */
  @SubscribeMessage("trip:status")
  async onTripStatus(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tripId: string; status: string; reason?: string },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "DRIVER") return;
    if (!this.allowEvent(socket, "trip:status")) {
      socket.emit("ride:error", { message: "rate_limited" });
      return;
    }
    try {
      // التحقق من الملكية يتم داخل driverChangeStatus؛ لا ننضم
      // للغرفة إلا بعد نجاح العملية (منع انضمام غير مصرّح).
      await this.trips.driverChangeStatus(
        user.userId,
        body.tripId,
        body.status as TripStatus,
        body.reason,
      );
      socket.join(`trip:${body.tripId}`);
    } catch (err) {
      socket.emit("ride:error", { message: (err as Error).message });
    }
  }

  /** إرسال حدث لمستخدم معيّن (غرفة user:{id}) */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  /** بثّ رسالة دردشة لطرفي الرحلة (غرفة trip:{id} فقط — لا تصل المدراء). */
  emitTripMessage(
    tripId: string,
    message: {
      id: string;
      tripId: string;
      senderId: string;
      body: string;
      createdAt: Date | string;
    },
  ): void {
    this.server.to(`trip:${tripId}`).emit("trip:message", {
      ...message,
      createdAt:
        message.createdAt instanceof Date
          ? message.createdAt.toISOString()
          : message.createdAt,
    });
  }

  /**
   * إيصال قراءة: يُعلِم الطرف الآخر أن رسائله قُرئت.
   *
   * `readerId` هو من قرأ؛ العميل يتجاهل الحدث إن كان هو القارئ، ويضع علامة
   * القراءة على رسائله المُرسَلة إن كان هو الطرف الآخر. البثّ لغرفة الرحلة فقط.
   */
  emitTripMessagesRead(tripId: string, readerId: string, readAt: Date): void {
    this.server.to(`trip:${tripId}`).emit("trip:messages_read", {
      tripId,
      readerId,
      readAt: readAt.toISOString(),
    });
  }

  /** يستدعى من الخدمات لبث تغيير حالة الرحلة لحظيًا */
  emitTripStatus(tripId: string, status: string): void {
    this.server.to(`trip:${tripId}`).emit("trip:status", { tripId, status });
    this.server.to("admins").emit("trip:status", { tripId, status });
  }
}
