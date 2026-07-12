import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, UserStatus, UserType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { StorageService } from "../storage/storage.service";
import { PassengerUploadUrlDto, UpdatePassengerProfileDto } from "./dto/passenger-self.dto";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(q: PaginationDto, type?: UserType) {
    const where: Prisma.UserWhereInput = {
      ...(type ? { type } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: "insensitive" } },
              { phone: { contains: q.search } },
              { email: { contains: q.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          type: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        wallet: true,
        ratingsReceived: { take: 10, orderBy: { createdAt: "desc" } },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async trips(id: string, q: PaginationDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where: { passengerId: id },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.trip.count({ where: { passengerId: id } }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  async getPassengerProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, type: UserType.PASSENGER },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        avatarUrl: true,
        locale: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException("Passenger profile not found");
    return { ...user, profileComplete: !user.phone.startsWith("fb_") };
  }

  async updatePassengerProfile(userId: string, dto: UpdatePassengerProfileDto) {
    const current = await this.getPassengerProfile(userId);
    if (current.status !== UserStatus.ACTIVE) {
      throw new BadRequestException("Account is not active");
    }
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: dto.name?.trim(),
          phone: dto.phone?.trim(),
          avatarUrl: dto.avatarUrl?.trim(),
          locale: dto.locale?.trim(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Phone number is already registered");
      }
      throw error;
    }
    return this.getPassengerProfile(userId);
  }

  async createPassengerUploadUrl(userId: string, dto: PassengerUploadUrlDto) {
    await this.getPassengerProfile(userId);
    if (!this.storage.isEnabled()) {
      throw new BadRequestException("File storage is not configured");
    }
    const contentType = dto.contentType ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new BadRequestException("Only profile images are allowed");
    }
    const ext = contentType.includes("png") ? "png" : "jpg";
    const objectPath = `passenger-profiles/${userId}/avatar.${ext}`;
    const uploadUrl = await this.storage.signedUploadUrl(objectPath, contentType);
    const readUrl = await this.storage.signedReadUrl(objectPath, 60 * 24 * 7);
    return { uploadUrl, objectPath, readUrl, contentType };
  }

  setStatus(id: string, status: UserStatus) {
    return this.prisma.user.update({ where: { id }, data: { status } });
  }
}
