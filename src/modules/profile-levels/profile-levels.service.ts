import { Inject, Injectable, Logger, Optional, forwardRef } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  StorageService,
  STORED_MEDIA_READ_TTL_MINUTES,
} from "../storage/storage.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  describeProfileLevel,
  getProfileLevel,
  type ProfileLevel,
  type ProfileLevelProgress,
} from "./profile-level.util";

/** حدث لحظي واحد لتحديث المستوى (يستعمل Socket.IO الموجود، بلا نظام ثانٍ). */
export const PROFILE_LEVEL_EVENT = "profile:level";

export interface ProfileLevelView extends ProfileLevelProgress {
  /** الرابط العام المولّد من مفتاح الكائن عبر StorageService (R2_PUBLIC_URL). */
  profileFrameUrl: string | null;
}

/**
 * المرحلة 11 — خدمة مستويات الملف الشخصي.
 *
 * مصدر الحقيقة: جدول Trip نفسه (status = COMPLETED). لا عمود جديد ولا عدّاد
 * موازٍ، لأن:
 *   - الفهارس @@index([passengerId, status]) و @@index([driverId, status])
 *     موجودة أصلًا، فالعدّ استعلام مفهرس واحد بلا N+1.
 *   - العدّ من الرحلات نفسها idempotent بطبيعته: إعادة تنفيذ الإكمال أو تنفيذه
 *     مرتين لا يمكن أن ترفع العدد مرتين، ولا يوجد race condition ممكن لأن لا
 *     شيء يُزاد (increment) هنا إطلاقًا.
 *   - وبهذا لا يوجد مصدران متعارضان: completedTripsCount → profileLevel →
 *     profileFrame كلها مشتقة في اتجاه واحد.
 *
 * Driver.totalTrips الموجود سابقًا كان يُقرأ (شروط أنواع المركبات والتقارير)
 * ولا يُكتب أبدًا. لا نجعله مصدرًا ثانيًا للحقيقة: نُزامنه بإسناد العدد
 * المفهرس (assignment لا increment) عند كل إكمال، فيصحّح نفسه ذاتيًا.
 */
@Injectable()
export class ProfileLevelsService {
  private readonly logger = new Logger(ProfileLevelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    // اختياري وبـ forwardRef: البثّ اللحظي تحسين للعرض ولا يجوز أن يُسقط
    // إكمال الرحلة أو يُنشئ حلقة تبعية صلبة مع RealtimeModule.
    @Optional()
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtime?: RealtimeGateway,
  ) {}

  /** رحلات الراكب المكتملة فعليًا (COMPLETED فقط). */
  async passengerCompletedTrips(passengerUserId: string): Promise<number> {
    return this.prisma.trip.count({
      where: { passengerId: passengerUserId, status: "COMPLETED" },
    });
  }

  /** رحلات السائق المكتملة فعليًا (عدّاد مستقل تمامًا عن الراكب). */
  async driverCompletedTrips(driverId: string): Promise<number> {
    return this.prisma.trip.count({
      where: { driverId, status: "COMPLETED" },
    });
  }

  /** يبني وصف المستوى + رابط الإطار من عدد الرحلات المكتملة. */
  async view(completedTripsCount: number): Promise<ProfileLevelView> {
    const progress = describeProfileLevel(completedTripsCount);
    return {
      ...progress,
      profileFrameUrl: await this.frameUrl(progress.profileFrameKey),
    };
  }

  async forPassenger(passengerUserId: string): Promise<ProfileLevelView> {
    return this.view(await this.passengerCompletedTrips(passengerUserId));
  }

  async forDriver(driverId: string): Promise<ProfileLevelView> {
    return this.view(await this.driverCompletedTrips(driverId));
  }

  /**
   * دفعة واحدة لعدة ركاب (groupBy) — للاستعمال في القوائم بلا N+1.
   * الروابط تُولّد مرة واحدة لكل مستوى مستعمل، لا لكل مستخدم.
   */
  async forPassengers(
    passengerUserIds: string[],
  ): Promise<Map<string, ProfileLevelView>> {
    const ids = [...new Set(passengerUserIds.filter(Boolean))];
    const out = new Map<string, ProfileLevelView>();
    if (!ids.length) return out;
    const rows = await this.prisma.trip.groupBy({
      by: ["passengerId"],
      where: { passengerId: { in: ids }, status: "COMPLETED" },
      orderBy: { passengerId: "asc" },
      _count: { _all: true },
    });
    const counts = new Map(
      (rows as unknown as Array<{ passengerId: string; _count: { _all: number } }>).map(
        (row) => [row.passengerId, row._count._all],
      ),
    );
    const cache = new Map<ProfileLevel, ProfileLevelView>();
    for (const id of ids) {
      const count = counts.get(id) ?? 0;
      const level = getProfileLevel(count);
      const template = cache.get(level) ?? (await this.view(count));
      cache.set(level, template);
      out.set(id, { ...describeProfileLevel(count), profileFrameUrl: template.profileFrameUrl });
    }
    return out;
  }

  /** دفعة واحدة لعدة سائقين (groupBy على driverId). */
  async forDrivers(driverIds: string[]): Promise<Map<string, ProfileLevelView>> {
    const ids = [...new Set(driverIds.filter(Boolean))];
    const out = new Map<string, ProfileLevelView>();
    if (!ids.length) return out;
    const rows = await this.prisma.trip.groupBy({
      by: ["driverId"],
      where: { driverId: { in: ids }, status: "COMPLETED" },
      orderBy: { driverId: "asc" },
      _count: { _all: true },
    });
    const counts = new Map(
      (rows as unknown as Array<{ driverId: string | null; _count: { _all: number } }>)
        .filter((row) => row.driverId !== null)
        .map((row) => [row.driverId as string, row._count._all]),
    );
    const cache = new Map<ProfileLevel, ProfileLevelView>();
    for (const id of ids) {
      const count = counts.get(id) ?? 0;
      const level = getProfileLevel(count);
      const template = cache.get(level) ?? (await this.view(count));
      cache.set(level, template);
      out.set(id, { ...describeProfileLevel(count), profileFrameUrl: template.profileFrameUrl });
    }
    return out;
  }

  /**
   * يُستدعى بعد أن تصبح الرحلة COMPLETED فعليًا في قاعدة البيانات.
   *
   * لا يزيد أي عدّاد: يقرأ العدد المفهرس الحقيقي، يزامن Driver.totalTrips
   * بإسناد، ويبثّ المستوى الجديد للطرفين. آمن للتنفيذ أكثر من مرة.
   */
  async onTripCompleted(tripId: string): Promise<void> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        status: true,
        passengerId: true,
        driverId: true,
        driver: { select: { userId: true } },
      },
    });
    // تحقّق فعلي من الاكتمال: لا نعتمد على من نادانا.
    if (!trip || trip.status !== "COMPLETED") return;

    if (trip.passengerId) {
      await this.syncPassenger(trip.passengerId);
    }
    if (trip.driverId) {
      await this.syncDriver(trip.driverId, trip.driver?.userId ?? null);
    }
  }

  private async syncPassenger(passengerUserId: string): Promise<void> {
    const count = await this.passengerCompletedTrips(passengerUserId);
    const view = await this.view(count);
    this.emit(passengerUserId, "PASSENGER", count, view);
  }

  private async syncDriver(
    driverId: string,
    driverUserId: string | null,
  ): Promise<void> {
    const count = await this.driverCompletedTrips(driverId);
    // إسناد لا زيادة: idempotent، ومحصّن ضد التزامن، ويصحّح العدّاد الميت سابقًا.
    await this.prisma.driver
      .updateMany({ where: { id: driverId }, data: { totalTrips: count } })
      .catch((err: unknown) =>
        this.logger.warn(
          `تعذّر مزامنة عدّاد رحلات السائق ${driverId}: ${(err as Error).message}`,
        ),
      );
    const view = await this.view(count);
    if (driverUserId) this.emit(driverUserId, "DRIVER", count, view);
  }

  /**
   * بثّ لحظي على القناة الموجودة (غرفة user:{id}) حتى يظهر الانتقال
   * BRONZE → SILVER بلا logout/login. levelUp يميّز الانتقال عن التحديث العادي.
   */
  private emit(
    userId: string,
    scope: "PASSENGER" | "DRIVER",
    count: number,
    view: ProfileLevelView,
  ): void {
    if (!this.realtime) return;
    const previousLevel = getProfileLevel(Math.max(0, count - 1));
    try {
      this.realtime.emitToUser(userId, PROFILE_LEVEL_EVENT, {
        scope,
        completedTripsCount: view.completedTripsCount,
        profileLevel: view.profileLevel,
        profileFrameUrl: view.profileFrameUrl,
        nextLevel: view.nextLevel,
        nextLevelAt: view.nextLevelAt,
        levelUp: previousLevel !== view.profileLevel,
        previousLevel,
      });
    } catch (err) {
      this.logger.warn(
        `تعذّر بثّ تحديث المستوى للمستخدم ${userId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * مفتاح الكائن → رابط عام. لا نظام روابط ثانٍ: نفس StorageService المستخدم
   * للصور والوثائق (publicUrl من R2_PUBLIC_URL، وإلا رابط موقّع مؤقّت).
   */
  private async frameUrl(objectKey: string): Promise<string | null> {
    const direct = this.storage.publicUrl(objectKey);
    if (direct) return direct;
    if (!this.storage.isEnabled()) return null;
    try {
      return await this.storage.readUrl(objectKey, STORED_MEDIA_READ_TTL_MINUTES);
    } catch {
      this.logger.warn(`تعذّر توليد رابط إطار الملف الشخصي ${objectKey}`);
      return null;
    }
  }
}
