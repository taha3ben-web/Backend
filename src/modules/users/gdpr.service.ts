import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { FinancialService } from "../financial/financial.service";

/**
 * GDPR: قابلية نقل البيانات وحق الوصول (data portability / right to access).
 * يجمع كل البيانات الشخصية للمستخدم في حزمة JSON واحدة قابلة للتنزيل.
 * قراءة فقط لا تعدّل أي بيانات (عدا سطر تدقيق واحد يسجّل عملية التصدير).
 * حق المحو (erasure) مُغطّى مسبقًا عبر AccountDeletionRequest في UsersService.
 */
@Injectable()
export class GdprService {
  private readonly cap = 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly financial: FinancialService,
  ) {}

  async exportUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        phone: true,
        email: true,
        type: true,
        status: true,
        avatarUrl: true,
        locale: true,
        gender: true,
        onboardingCompletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new NotFoundException("User not found");

    const take = this.cap;
    const [
      trips,
      payments,
      ratingsGiven,
      ratingsReceived,
      complaints,
      supportTickets,
      consents,
      savedPlaces,
      emergencyContacts,
      deviceTokens,
      invoices,
    ] = await this.prisma.$transaction([
      this.prisma.trip.findMany({
        where: { passengerId: userId },
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          rideClass: true,
          fare: true,
          currency: true,
          pickupAddress: true,
          destAddress: true,
          distanceKm: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { userId },
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          tripId: true,
          createdAt: true,
        },
      }),
      this.prisma.rating.findMany({
        where: { authorId: userId },
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, tripId: true, stars: true, comment: true, createdAt: true },
      }),
      this.prisma.rating.findMany({
        where: { targetId: userId },
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, tripId: true, stars: true, comment: true, createdAt: true },
      }),
      this.prisma.complaint.findMany({
        where: { OR: [{ fromUserId: userId }, { againstUserId: userId }] },
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, message: true, status: true, tripId: true, createdAt: true },
      }),
      this.prisma.supportTicket.findMany({
        where: { userId },
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          subject: true,
          category: true,
          status: true,
          priority: true,
          createdAt: true,
        },
      }),
      this.prisma.userConsent.findMany({
        where: { userId },
        take,
        orderBy: { acceptedAt: "desc" },
        select: { id: true, documentId: true, version: true, acceptedAt: true, source: true },
      }),
      this.prisma.savedPlace.findMany({
        where: { userId },
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          kind: true,
          label: true,
          address: true,
          lat: true,
          lng: true,
          createdAt: true,
        },
      }),
      this.prisma.emergencyContact.findMany({
        where: { userId },
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, phone: true, relation: true, createdAt: true },
      }),
      this.prisma.deviceToken.findMany({
        where: { userId },
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, platform: true, createdAt: true },
      }),
      this.prisma.invoice.findMany({
        where: { userId },
        take,
        orderBy: { issuedAt: "desc" },
        select: {
          id: true,
          number: true,
          tripId: true,
          currency: true,
          total: true,
          status: true,
          issuedAt: true,
        },
      }),
    ]);

    const wallet = await this.financial.getUserBalance(userId);

    await this.prisma.auditLog.create({
      data: {
        actorId: userId,
        action: "PASSENGER_DATA_EXPORTED",
        entity: "User",
        entityId: userId,
      },
    });

    return {
      exportedAt: new Date().toISOString(),
      format: "json" as const,
      note: "GDPR data export — personal data only, capped at 1000 rows per collection.",
      subject: user,
      wallet,
      trips,
      payments,
      ratings: { given: ratingsGiven, received: ratingsReceived },
      complaints,
      supportTickets,
      consents,
      savedPlaces,
      emergencyContacts,
      deviceTokens,
      invoices,
    };
  }
}
