import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ComplaintStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { CreateComplaintDto } from "./dto/support.dto";

@Injectable()
export class ComplaintsService {
  constructor(private readonly prisma: PrismaService) {}

  /** مستخدم يقدّم شكوى (ربما ضد طرف آخر أو مرتبطة برحلة) */
  async create(fromUserId: string, dto: CreateComplaintDto) {
    let againstUserId = dto.againstUserId;
    if (dto.tripId) {
      const trip = await this.prisma.trip.findUnique({
        where: { id: dto.tripId },
        select: { passengerId: true, driverId: true },
      });
      if (!trip) throw new NotFoundException("Trip not found");
      const isPassenger = trip.passengerId === fromUserId;
      const isDriver = trip.driverId === fromUserId;
      if (!isPassenger && !isDriver) {
        throw new ForbiddenException("Trip is not accessible");
      }
      const otherPartyId = isPassenger ? trip.driverId : trip.passengerId;
      if (againstUserId && againstUserId !== otherPartyId) {
        throw new ForbiddenException("Reported user is not the other trip party");
      }
      againstUserId = otherPartyId ?? undefined;
    } else if (againstUserId) {
      throw new BadRequestException("A trip is required when reporting a user");
    }
    return this.prisma.complaint.create({
      data: {
        fromUserId,
        tripId: dto.tripId,
        againstUserId,
        message: dto.message,
        status: "OPEN",
      },
    });
  }

  /** كل الشكاوى (للدعم) مع فلترة الحالة */
  async findAll(q: PaginationDto, status?: ComplaintStatus) {
    const where: Prisma.ComplaintWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.complaint.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        include: {
          fromUser: { select: { name: true, phone: true } },
          againstUser: { select: { name: true, phone: true } },
        },
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const complaint = await this.prisma.complaint.findUnique({
      where: { id },
      include: {
        fromUser: { select: { name: true, phone: true } },
        againstUser: { select: { name: true, phone: true } },
        trip: { select: { id: true, status: true } },
      },
    });
    if (!complaint) throw new NotFoundException("الشكوى غير موجودة");
    return complaint;
  }

  /** تحديث حالة الشكوى (مراجعة/حل) مع تسجيل المُحل */
  async updateStatus(
    id: string,
    status: ComplaintStatus,
    resolvedById: string,
  ) {
    await this.findOne(id);
    return this.prisma.complaint.update({
      where: { id },
      data: {
        status,
        resolvedById: status === "RESOLVED" ? resolvedById : null,
        resolvedAt: status === "RESOLVED" ? new Date() : null,
      },
    });
  }
}
