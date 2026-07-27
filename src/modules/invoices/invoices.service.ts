import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { TransactionalEmailService } from "../notifications/transactional-email.service";
import { formatEmailAmount } from "../notifications/transactional-email.util";
import { buildPdf, type PdfTable } from "../reports/generators/pdf.generator";
import {
  buildInvoiceNumber,
  formatAmount,
  invoicePeriod,
  money,
} from "./invoice-number.util";

/** مدة صلاحية رابط تنزيل الفاتورة الموقّع. */
export const INVOICE_URL_TTL_MIN = 15;

export interface InvoiceFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

/**
 * فواتير الرحلات.
 *
 * قاعدتان محاسبيتان غير قابلتين للتفاوض:
 * 1. رقم متسلسل بلا فجوات لكل شهر (عبر عدّاد ذري في قاعدة البيانات).
 * 2. لقطة (snapshot) مجمّدة للمبالغ وقت الإصدار؛ تغيّر التسعيرة لاحقًا
 *    يجب ألا يغيّر فاتورة صدرت.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger("Invoices");

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly mailer?: TransactionalEmailService,
  ) {}

  /** يُصدر فاتورة الرحلة أو يُرجع الموجودة (إجراء خامل التكرار). */
  async issueForTrip(tripId: string, requesterId?: string) {
    const existing = await this.prisma.invoice.findUnique({
      where: { tripId },
    });
    if (existing) {
      if (requesterId && existing.userId !== requesterId) {
        throw new ForbiddenException("هذه الفاتورة ليست لك");
      }
      return existing;
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        id: true,
        passengerId: true,
        status: true,
        fare: true,
        discountAmount: true,
        currency: true,
        paymentMethod: true,
        distanceKm: true,
        durationSec: true,
        pickupAddress: true,
        destAddress: true,
        completedAt: true,
        createdAt: true,
        driver: { select: { user: { select: { name: true } } } },
        payment: { select: { status: true, method: true, provider: true } },
      },
    });
    if (!trip) throw new NotFoundException("الرحلة غير موجودة");
    if (requesterId && trip.passengerId !== requesterId) {
      throw new ForbiddenException("لا تملك صلاحية على هذه الرحلة");
    }
    if (trip.status !== "COMPLETED") {
      throw new ForbiddenException("تُصدر الفاتورة بعد اكتمال الرحلة فقط");
    }

    const issuedAt = trip.completedAt ?? new Date();
    const period = invoicePeriod(issuedAt);
    const total = money(trip.fare);
    const discount = money(trip.discountAmount);
    const subtotal = money(total + discount);

    const number = buildInvoiceNumber(period, await this.nextSequence(period));

    const invoice = await this.prisma.invoice.create({
      data: {
        number,
        tripId: trip.id,
        userId: trip.passengerId,
        currency: trip.currency,
        subtotal: new Prisma.Decimal(subtotal),
        discount: new Prisma.Decimal(discount),
        total: new Prisma.Decimal(total),
        paymentMethod: trip.payment?.method ?? trip.paymentMethod,
        issuedAt,
        snapshot: {
          tripId: trip.id,
          distanceKm: trip.distanceKm,
          durationSec: trip.durationSec,
          pickupAddress: trip.pickupAddress,
          destAddress: trip.destAddress,
          driverName: trip.driver?.user?.name ?? null,
          paymentStatus: trip.payment?.status ?? null,
          paymentProvider: trip.payment?.provider ?? null,
          startedAt: trip.createdAt.toISOString(),
          completedAt: issuedAt.toISOString(),
        },
      },
    });

    // إشعار بريد — أفضل جهد؛ لا يجوز أن يُرجِع فاتورة صدرت فعلًا.
    this.mailer?.fireAndForget({
      userId: invoice.userId,
      template: "invoice_ready",
      vars: {
        invoiceNumber: invoice.number,
        amount: formatEmailAmount(invoice.total),
        currency: invoice.currency,
      },
    });

    return invoice;
  }

  /**
   * عدّاد تسلسلي ذري: INSERT ... ON CONFLICT DO UPDATE يضمن رقمًا فريدًا
   * حتّى مع إصدار متزامن من عدّة نسخ من الخادم.
   */
  private async nextSequence(period: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ lastValue: number }>>`
      INSERT INTO "InvoiceSequence" ("period", "lastValue", "updatedAt")
      VALUES (${period}, 1, NOW())
      ON CONFLICT ("period")
      DO UPDATE SET "lastValue" = "InvoiceSequence"."lastValue" + 1, "updatedAt" = NOW()
      RETURNING "lastValue"
    `;
    const value = Number(rows[0]?.lastValue ?? 0);
    if (!Number.isFinite(value) || value < 1) {
      throw new Error("تعذر توليد رقم فاتورة متسلسل");
    }
    return value;
  }

  /** فواتير المستخدم مع ترقيم صفحات. */
  async mine(userId: string, q: PaginationDto) {
    const where = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issuedAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items, total, page: q.page, limit: q.limit };
  }

  /** يُرجع ملف PDF للفاتورة، مع تخزين اختياري على GCS لتجنّب إعادة التوليد. */
  async pdf(userId: string, invoiceId: string): Promise<InvoiceFile> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new NotFoundException("الفاتورة غير موجودة");
    if (invoice.userId !== userId) {
      throw new ForbiddenException("هذه الفاتورة ليست لك");
    }

    const snapshot = (invoice.snapshot ?? {}) as Record<string, unknown>;
    const currency = invoice.currency;
    const table: PdfTable = {
      heading: `فاتورة ${invoice.number}`,
      columns: [
        { header: "البند", key: "label", width: 240 },
        { header: "القيمة", key: "value", width: 260 },
      ],
      rows: [
        { label: "رقم الفاتورة", value: invoice.number },
        { label: "رقم الرحلة", value: invoice.tripId },
        {
          label: "تاريخ الإصدار",
          value: invoice.issuedAt.toISOString().slice(0, 16).replace("T", " "),
        },
        { label: "من ", value: snapshot.pickupAddress ?? "—" },
        { label: "إلى", value: snapshot.destAddress ?? "—" },
        { label: "المسافة (كم)", value: snapshot.distanceKm ?? "—" },
        {
          label: "المدة (دقيقة)",
          value: snapshot.durationSec
            ? Math.round(Number(snapshot.durationSec) / 60)
            : "—",
        },
        { label: "السائق", value: snapshot.driverName ?? "—" },
        { label: "طريقة الدفع", value: invoice.paymentMethod },
        {
          label: "المجموع الفرعي",
          value: formatAmount(invoice.subtotal, currency),
        },
        { label: "الخصم", value: formatAmount(invoice.discount, currency) },
        {
          label: "المبلغ الإجمالي",
          value: formatAmount(invoice.total, currency),
        },
      ],
    };

    const buffer = await buildPdf("flaminGO — فاتورة رحلة", [table]);
    const filename = `${invoice.number}.pdf`;

    if (!invoice.pdfPath && this.storage?.isEnabled()) {
      const objectPath = `invoices/${invoice.userId}/${filename}`;
      try {
        await this.storage.upload(objectPath, buffer, "application/pdf");
        await this.prisma.invoice.update({
          where: { id: invoice.id },
          data: { pdfPath: objectPath },
        });
      } catch (error) {
        this.logger.error(
          `تعذر رفع فاتورة ${invoice.number}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { filename, contentType: "application/pdf", buffer };
  }
}
