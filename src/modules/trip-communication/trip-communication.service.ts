import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SettingsService } from "../settings/settings.service";
import { PaginationDto } from "../../common/dto/pagination.dto";

type CommunicationPolicy = {
  enabled?: boolean;
  chatEnabled?: boolean;
  callEnabled?: boolean;
  phoneMode?: "HIDDEN" | "DIRECT" | "BRIDGE";
  bridgeNumber?: string;
  activeStatuses?: string[];
};

@Injectable()
export class TripCommunicationService {
  private readonly logger = new Logger(TripCommunicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime: RealtimeGateway,
  ) {}

  async context(userId: string, tripId: string) {
    const { trip, other } = await this.tripParty(userId, tripId);
    const policy = await this.policy();
    const active = policy.enabled === true && (policy.activeStatuses ?? []).includes(trip.status);
    const callable = active && policy.callEnabled === true;
    let phoneNumber: string | null = null;
    if (callable && policy.phoneMode === "DIRECT") phoneNumber = this.safePhone(other.phone);
    if (callable && policy.phoneMode === "BRIDGE") phoneNumber = this.safePhone(policy.bridgeNumber);
    return {
      tripId,
      status: trip.status,
      active,
      canChat: active && policy.chatEnabled === true,
      canCall: callable && phoneNumber !== null,
      phoneMode: policy.phoneMode ?? "HIDDEN",
      phoneNumber,
      participant: { id: other.id, name: other.name, avatarUrl: other.avatarUrl },
    };
  }

  async messages(userId: string, tripId: string, q: PaginationDto) {
    await this.tripParty(userId, tripId);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tripMessage.findMany({
        where: { tripId }, orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit, take: q.limit,
        select: { id: true, tripId: true, senderId: true, body: true, createdAt: true },
      }),
      this.prisma.tripMessage.count({ where: { tripId } }),
    ]);
    return { items: rows.reverse(), total, page: q.page, limit: q.limit };
  }

  async send(userId: string, tripId: string, body: string) {
    const context = await this.context(userId, tripId);
    if (!context.canChat) throw new ForbiddenException("Trip chat is not active");
    const message = await this.prisma.tripMessage.create({
      data: { tripId, senderId: userId, body: body.trim() },
      select: { id: true, tripId: true, senderId: true, body: true, createdAt: true },
    });
    // بثّ لحظي للطرف الآخر; فشل البثّ لا يُفشِل حفظ الرسالة.
    try {
      this.realtime.emitTripMessage(tripId, message);
    } catch (err) {
      this.logger.warn(
        `realtime emitTripMessage failed: ${(err as Error).message}`,
      );
    }
    return message;
  }

  private async tripParty(userId: string, tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true, status: true, passengerId: true,
        passenger: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        driver: { select: { user: { select: { id: true, name: true, phone: true, avatarUrl: true } } } },
      },
    });
    if (!trip) throw new NotFoundException("Trip not found");
    const driverUser = trip.driver?.user;
    const isPassenger = trip.passengerId === userId;
    const isDriver = driverUser?.id === userId;
    if (!isPassenger && !isDriver) throw new NotFoundException("Trip not found");
    const other = isPassenger ? driverUser : trip.passenger;
    if (!other) throw new ForbiddenException("Trip has no assigned participant");
    return { trip, other };
  }

  private policy() {
    return this.settings.getValue<CommunicationPolicy>("passenger.tripCommunication");
  }

  private safePhone(value?: string | null) {
    const phone = value?.trim() ?? "";
    return /^\+?[0-9]{6,20}$/.test(phone) ? phone : null;
  }
}
