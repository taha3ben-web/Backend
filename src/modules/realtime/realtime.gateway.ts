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

interface SocketUser {
  userId: string;
  role: string;
}

// قائمة سماح CORS للـ WebSocket — تطابق إعدادات HTTP (CORS_ORIGINS).
// إن لم تُضبط يُسمح للجميع (مناسب للتطوير فقط).
const WS_CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

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
 * WebSocket gateway:
 * - السائق يرسل موقعه (driver:location) كل 1–2 ثانية
 * - الراكب يستقبل (driver:moved) في غرفة رحلته
 * - المدير يستقبل كل التحركات في غرفة admins (خريطة حية)
 * - محرك المطابقة: عروض الرحلات (ride:offer) + رد السائق (ride:accept/decline)
 */
@WebSocketGateway({
  cors: { origin: WS_CORS_ORIGINS.length ? WS_CORS_ORIGINS : "*" },
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

  @SubscribeMessage("trip:join")
  async onTripJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { tripId: string },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || !body?.tripId) return;
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
    @MessageBody() body: { lat: number; lng: number; heading?: number },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "DRIVER") return;
    if (!isValidLatLng(body?.lat, body?.lng)) return;

    await this.redis.setDriverLocation(
      user.userId,
      body.lat,
      body.lng,
      body.heading ?? 0,
    );

    const payload = {
      driverId: user.userId,
      lat: body.lat,
      lng: body.lng,
      heading: body.heading ?? 0,
    };

    // خريطة المدير الحية
    this.server.to("admins").emit("driver:moved", payload);

    // راكب الرحلة النشطة (إن وجدت)
    const tripId = await this.redis.client.get(`driver:${user.userId}:trip`);
    if (tripId) {
      this.server
        .to(`trip:${tripId}`)
        .emit("driver:moved", { tripId, ...payload });
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
      cityId?: string;
    },
  ): Promise<void> {
    const user: SocketUser | undefined = socket.data.user;
    if (!user || user.role !== "PASSENGER") return;
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

  /** يستدعى من الخدمات لبث تغيير حالة الرحلة لحظيًا */
  emitTripStatus(tripId: string, status: string): void {
    this.server.to(`trip:${tripId}`).emit("trip:status", { tripId, status });
    this.server.to("admins").emit("trip:status", { tripId, status });
  }
}
