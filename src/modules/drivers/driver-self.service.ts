import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DriverAvailability, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { round2 } from "../../common/money.util";
import {
  AddDocumentDto,
  SetAvailabilityDto,
  UpdateDriverProfileDto,
  UploadUrlDto,
} from "./dto/driver-self.dto";

type DriverWithRelations = Prisma.DriverGetPayload<{
  include: {
    user: { select: { name: true; phone: true; email: true; avatarUrl: true } };
    vehicles: true;
    documents: true;
    city: { select: { id: true; name: true } };
  };
}>;

/**
 * خدمة الخدمة الذاتية للسائق (تطبيق السائق):
 * ملف السائق، مركبته النشطة، توفّره، أرباحه، رحلاته، ووثائقه.
 * كل العمليات تُشتق من userId المستخرج من الـ JWT، ولا يصل السائق لبيانات غيره.
 */
@Injectable()
export class DriverSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async requireDriver(userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException("ملف السائق غير موجود");
    return driver;
  }

  async getProfile(userId: string) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      include: {
        user: {
          select: { name: true, phone: true, email: true, avatarUrl: true },
        },
        vehicles: { where: { isActive: true }, take: 1 },
        documents: { orderBy: { createdAt: "desc" } },
        city: { select: { id: true, name: true } },
      },
    });
    if (!driver) throw new NotFoundException("ملف السائق غير موجود");
    return this.serialize(driver as DriverWithRelations);
  }

  private serialize(driver: DriverWithRelations) {
    const vehicle = driver.vehicles?.[0] ?? null;
    const docUrl = (type: string) =>
      driver.documents?.find((d) => d.type === type)?.url ?? null;
    return {
      id: driver.id,
      userId: driver.userId,
      name: driver.user?.name ?? null,
      phone: driver.user?.phone ?? null,
      email: driver.user?.email ?? null,
      photoUrl: driver.user?.avatarUrl ?? docUrl("PROFILE_PHOTO"),
      status: driver.status,
      approved: driver.status === "APPROVED",
      availability: driver.availability,
      rating: Number(driver.rating),
      totalTrips: driver.totalTrips,
      cityId: driver.cityId ?? null,
      city: driver.city?.name ?? null,
      vehicle: vehicle
        ? {
            id: vehicle.id,
            make: vehicle.make,
            model: vehicle.model,
            color: vehicle.color ?? null,
            plate: vehicle.plate,
            year: vehicle.year ?? null,
            rideClass: vehicle.rideClass,
          }
        : null,
      documents: (driver.documents ?? []).map((d) => ({
        id: d.id,
        type: d.type,
        url: d.url,
        status: d.status,
      })),
    };
  }

  async updateProfile(userId: string, dto: UpdateDriverProfileDto) {
    const driver = await this.requireDriver(userId);

    if (dto.name) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name },
      });
    }

    if (dto.cityId !== undefined) {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { cityId: dto.cityId || null },
      });
    }

    const touchesVehicle =
      dto.carMake !== undefined ||
      dto.carModel !== undefined ||
      dto.carColor !== undefined ||
      dto.carPlate !== undefined ||
      dto.carYear !== undefined ||
      dto.rideClass !== undefined;

    if (touchesVehicle) {
      const active = await this.prisma.vehicle.findFirst({
        where: { driverId: driver.id, isActive: true },
      });
      const model = dto.carModel ?? active?.model ?? "";
      const plate = (dto.carPlate ?? active?.plate ?? "").toUpperCase().trim();
      if (!model || !plate) {
        throw new BadRequestException("طراز المركبة ولوحة التسجيل مطلوبة");
      }
      const data = {
        make: dto.carMake ?? active?.make ?? model,
        model,
        color: dto.carColor ?? active?.color ?? null,
        plate,
        year: dto.carYear ?? active?.year ?? null,
        rideClass: dto.rideClass ?? active?.rideClass ?? "ECONOMY",
      };
      if (active) {
        await this.prisma.vehicle.update({ where: { id: active.id }, data });
      } else {
        await this.prisma.vehicle.create({
          data: { driverId: driver.id, isActive: true, ...data },
        });
      }
    }

    return this.getProfile(userId);
  }

  async setAvailability(userId: string, dto: SetAvailabilityDto) {
    const driver = await this.requireDriver(userId);
    if (dto.availability === "ONLINE" && driver.status !== "APPROVED") {
      throw new ForbiddenException("لا يمكنك الاتصال قبل اعتماد حسابك");
    }
    if (driver.availability === "ON_TRIP") {
      throw new BadRequestException("لا يمكن تغيير الحالة أثناء رحلة نشطة");
    }
    await this.prisma.driver.update({
      where: { id: driver.id },
      data: {
        availability: dto.availability as DriverAvailability,
        lastSeenAt: new Date(),
      },
    });
    return { availability: dto.availability };
  }

  async earnings(userId: string) {
    const driver = await this.requireDriver(userId);
    const items = await this.prisma.driverEarning.findMany({
      where: { driverId: driver.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        trip: {
          select: {
            id: true,
            destAddress: true,
            distanceKm: true,
            rideClass: true,
            completedAt: true,
          },
        },
      },
    });

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));

    let today = 0;
    let week = 0;
    let all = 0;
    for (const e of items) {
      const net = Number(e.net);
      all += net;
      if (e.createdAt >= startOfDay) today += net;
      if (e.createdAt >= startOfWeek) week += net;
    }
    return {
      totals: {
        today: round2(today),
        week: round2(week),
        all: round2(all),
        trips: driver.totalTrips,
      },
      items: items.map((e) => ({
        id: e.id,
        tripId: e.tripId,
        gross: Number(e.gross),
        commission: Number(e.commission),
        net: Number(e.net),
        createdAt: e.createdAt,
        trip: e.trip,
      })),
    };
  }

  async trips(userId: string, q: PaginationDto) {
    const driver = await this.requireDriver(userId);
    const where: Prisma.TripWhereInput = { driverId: driver.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { passenger: { select: { name: true } } },
      }),
      this.prisma.trip.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async addDocument(userId: string, dto: AddDocumentDto) {
    const driver = await this.requireDriver(userId);
    return this.prisma.driverDocument.create({
      data: {
        driverId: driver.id,
        type: dto.type,
        url: dto.url,
        status: "PENDING",
      },
    });
  }

  async createUploadUrl(userId: string, dto: UploadUrlDto) {
    const driver = await this.requireDriver(userId);
    if (!this.storage.isEnabled()) {
      throw new BadRequestException("خدمة التخزين غير مفعّلة على الخادم");
    }
    const contentType = dto.contentType ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const objectPath = `driver-docs/${driver.id}/${dto.kind}-${Date.now()}.${ext}`;
    const uploadUrl = await this.storage.signedUploadUrl(objectPath, contentType);
    const readUrl = await this.storage.signedReadUrl(objectPath, 60 * 24 * 7);
    return { uploadUrl, objectPath, readUrl };
  }
}
