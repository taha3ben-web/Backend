import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class DriverQrService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveForDriver(driverId: string) {
    await this.requireDriver(driverId);
    return this.prisma.driverQrCode.findFirst({
      where: { driverId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      include: this.includeShape(),
    });
  }

  async issue(driverId: string, actorUserId?: string, expiresInDays = 90) {
    await this.requireDriver(driverId);
    const active = await this.getActiveForDriver(driverId);
    if (active && !this.isExpired(active.expiresAt)) {
      return active;
    }
    if (active && this.isExpired(active.expiresAt)) {
      await this.revokeRecord(active.id, actorUserId);
    }
    return this.createRecord(driverId, actorUserId, expiresInDays);
  }

  async rotate(driverId: string, actorUserId?: string, expiresInDays = 90) {
    await this.requireDriver(driverId);
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.driverQrCode.findFirst({
        where: { driverId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });
      if (active) {
        await tx.driverQrCode.update({
          where: { id: active.id },
          data: {
            status: "REVOKED",
            revokedAt: new Date(),
            revokedById: actorUserId ?? null,
          },
        });
      }
      const code = await tx.driverQrCode.create({
        data: {
          driverId,
          publicIdentifier: this.generateIdentifier(),
          issuedById: actorUserId ?? null,
          expiresAt: this.buildExpiry(expiresInDays),
          status: "ACTIVE",
        },
        include: this.includeShape(),
      });
      return code;
    });
  }

  async revoke(driverId: string, actorUserId?: string) {
    await this.requireDriver(driverId);
    const active = await this.prisma.driverQrCode.findFirst({
      where: { driverId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    if (!active) {
      throw new NotFoundException("لا يوجد QR فعّال لهذا السائق");
    }
    await this.revokeRecord(active.id, actorUserId);
    return { revoked: true, id: active.id };
  }

  async resolve(publicIdentifier: string) {
    const code = await this.prisma.driverQrCode.findUnique({
      where: { publicIdentifier },
      include: this.includeShape(),
    });
    if (!code) throw new NotFoundException("QR غير موجود");
    if (code.status !== "ACTIVE") {
      throw new BadRequestException("QR غير صالح");
    }
    if (this.isExpired(code.expiresAt)) {
      throw new BadRequestException("QR منتهي الصلاحية");
    }
    if (code.driver.status !== "APPROVED") {
      throw new BadRequestException("السائق غير مؤهل حاليًا");
    }

    const vehicle = code.driver.vehicles[0] ?? null;
    return {
      publicIdentifier: code.publicIdentifier,
      driver: {
        id: code.driver.id,
        name: code.driver.user.name,
        phone: code.driver.user.phone,
        status: code.driver.status,
        availability: code.driver.availability,
        city: code.driver.city?.name ?? null,
        vehicle: vehicle
          ? {
              plate: vehicle.plate,
              make: vehicle.make,
              model: vehicle.model,
              color: vehicle.color ?? null,
              rideClass: vehicle.rideClass,
            }
          : null,
      },
      expiresAt: code.expiresAt,
    };
  }

  private async createRecord(
    driverId: string,
    actorUserId?: string,
    expiresInDays = 90,
  ) {
    return this.prisma.driverQrCode.create({
      data: {
        driverId,
        publicIdentifier: this.generateIdentifier(),
        issuedById: actorUserId ?? null,
        expiresAt: this.buildExpiry(expiresInDays),
        status: "ACTIVE",
      },
      include: this.includeShape(),
    });
  }

  private async revokeRecord(id: string, actorUserId?: string) {
    return this.prisma.driverQrCode.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedById: actorUserId ?? null,
      },
    });
  }

  private async requireDriver(driverId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException("السائق غير موجود");
    return driver;
  }

  private generateIdentifier() {
    return `drvqr_${randomBytes(12).toString("base64url")}`;
  }

  private buildExpiry(expiresInDays: number) {
    return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  }

  private isExpired(expiresAt: Date | null) {
    return expiresAt ? expiresAt.getTime() <= Date.now() : false;
  }

  private includeShape() {
    return {
      driver: {
        include: {
          user: { select: { id: true, name: true, phone: true, status: true } },
          city: { select: { id: true, name: true } },
          vehicles: { where: { isActive: true }, take: 1 },
        },
      },
      issuedBy: { select: { id: true, name: true, type: true } },
      revokedBy: { select: { id: true, name: true, type: true } },
    } satisfies Prisma.DriverQrCodeInclude;
  }
}
