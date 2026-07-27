/**
 * دوال نقيّة لأرشفة الرحلات القديمة — قابلة للاختبار دون قاعدة بيانات.
 *
 * الفكرة: جدول Trip ينمو بلا حدّ (كل رحلة صف دائم)، وأبناؤه الثقيلون
 * (TripEvent, TripMessage) ينمون أسرع منه بعشرات الأضعاف. بعد سنة تصبح
 * استعلامات السجل والتقارير بطيئة لأنّ الفهارس لم تعد تسع في الذاكرة.
 *
 * الحل هنا: نسخة باردة (snapshot) لكل رحلة منتهية قديمة في TripArchive،
 * ثم حذف أبنائها الثقيلين فقط. صف Trip نفسه يبقى — لأنّ القيود المالية
 * (Payment, DriverEarning, Invoice) تشير إليه، وحذفه يكسر قابلية التدقيق.
 */

/** الحالات النهائية التي يجوز أرشفتها؛ أي حالة أخرى تعني رحلة قد تُستكمل. */
export const ARCHIVABLE_TRIP_STATUSES = ["COMPLETED", "CANCELLED"] as const;

/** حالات التسوية التي تعني أنّ المال استقرّ ولا حساب معلّق. */
export const ARCHIVABLE_SETTLEMENT_STATUSES = [
  "NOT_REQUIRED",
  "POSTED",
] as const;

/** عمر الرحلة الافتراضي قبل الأرشفة (بالأشهر). */
export const DEFAULT_TRIP_ARCHIVE_AFTER_MONTHS = 12;

/** أقل عمر مسموح — حماية من أرشفة رحلات حديثة بخطأ في الإعداد. */
export const MIN_TRIP_ARCHIVE_AFTER_MONTHS = 3;

/** حجم الدفعة الافتراضي في كل تشغيل. */
export const DEFAULT_TRIP_ARCHIVE_BATCH_SIZE = 200;

/** الحدّ الأقصى للدفعة — دفعة أكبر تقفل الجدول مدة أطول. */
export const MAX_TRIP_ARCHIVE_BATCH_SIZE = 2000;

/** عدد الأحداث والرسائل المحفوظة في النسخة الباردة لكل رحلة. */
export const SNAPSHOT_EVENT_LIMIT = 200;
export const SNAPSHOT_MESSAGE_LIMIT = 200;

export type ArchivableTripStatus = (typeof ARCHIVABLE_TRIP_STATUSES)[number];

/** يقرأ عمر الأرشفة من البيئة مع تثبيته على حدّ أدنى آمن. */
export function archiveAfterMonthsFromEnv(raw?: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TRIP_ARCHIVE_AFTER_MONTHS;
  }
  return Math.max(MIN_TRIP_ARCHIVE_AFTER_MONTHS, Math.floor(parsed));
}

/** يقرأ حجم الدفعة من البيئة مع تثبيته بين 1 والحدّ الأقصى. */
export function archiveBatchSizeFromEnv(raw?: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TRIP_ARCHIVE_BATCH_SIZE;
  }
  return Math.min(MAX_TRIP_ARCHIVE_BATCH_SIZE, Math.floor(parsed));
}

/** يحسب التاريخ الفاصل: كل رحلة انتهت قبله مرشّحة للأرشفة. */
export function archiveCutoff(now: Date, months: number): Date {
  const safeMonths = Math.max(MIN_TRIP_ARCHIVE_AFTER_MONTHS, months);
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - safeMonths,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
    ),
  );
}

/** الشكل المصغّر للرحلة الذي يكفي لقرار الأرشفة. */
export type ArchiveCandidate = {
  id: string;
  status: string;
  settlementStatus: string;
  completedAt: Date | null;
  createdAt: Date;
  archivedAt: Date | null;
  openLostItems?: number;
  openComplaints?: number;
};

/** تاريخ نهاية الرحلة الفعلي: completedAt إن وُجد، وإلا createdAt للملغاة. */
export function tripEndDate(trip: ArchiveCandidate): Date {
  return trip.completedAt ?? trip.createdAt;
}

/**
 * هل الرحلة صالحة للأرشفة؟ الشروط كلها يجب أن تتحقق:
 * حالة نهائية، تسوية مستقرّة، أقدم من الحدّ، غير مؤرشفة، ولا نزاع مفتوح.
 */
export function isArchivable(trip: ArchiveCandidate, cutoff: Date): boolean {
  if (trip.archivedAt !== null) return false;
  if (!(ARCHIVABLE_TRIP_STATUSES as readonly string[]).includes(trip.status)) {
    return false;
  }
  if (
    !(ARCHIVABLE_SETTLEMENT_STATUSES as readonly string[]).includes(
      trip.settlementStatus,
    )
  ) {
    return false;
  }
  if (tripEndDate(trip).getTime() >= cutoff.getTime()) return false;
  if ((trip.openLostItems ?? 0) > 0) return false;
  if ((trip.openComplaints ?? 0) > 0) return false;
  return true;
}

/** مدخلات بناء النسخة الباردة. */
export type SnapshotInput = {
  trip: Record<string, unknown>;
  events: Array<{
    type: string;
    actor: string;
    createdAt: Date;
    meta?: unknown;
  }>;
  messages: Array<{ senderId: string; body: string; createdAt: Date }>;
  trackingCount: number;
};

/** النسخة الباردة كما تُخزّن في العمود Json. */
export type TripSnapshot = {
  version: number;
  trip: Record<string, unknown>;
  events: Array<{
    type: string;
    actor: string;
    at: string;
    meta?: unknown;
  }>;
  messages: Array<{ senderId: string; body: string; at: string }>;
  counts: {
    events: number;
    messages: number;
    tracking: number;
    eventsTruncated: boolean;
    messagesTruncated: boolean;
  };
};

/** إصدار مخطّط النسخة الباردة — يُزاد عند أي تغيير في الشكل. */
export const TRIP_SNAPSHOT_VERSION = 1;

/**
 * يبني نسخة باردة مستقرّة الشكل. التواريخ تُحوّل إلى ISO لأنّ JSONB
 * لا يحفظ نوع التاريخ، والقصّ يُسجّل صراحة حتى لا يُقرأ ناقصًا كأنه كامل.
 */
export function buildTripSnapshot(input: SnapshotInput): TripSnapshot {
  const events = input.events.slice(0, SNAPSHOT_EVENT_LIMIT);
  const messages = input.messages.slice(0, SNAPSHOT_MESSAGE_LIMIT);
  return {
    version: TRIP_SNAPSHOT_VERSION,
    trip: input.trip,
    events: events.map((event) => ({
      type: event.type,
      actor: event.actor,
      at: event.createdAt.toISOString(),
      ...(event.meta === undefined || event.meta === null
        ? {}
        : { meta: event.meta }),
    })),
    messages: messages.map((message) => ({
      senderId: message.senderId,
      body: message.body,
      at: message.createdAt.toISOString(),
    })),
    counts: {
      events: input.events.length,
      messages: input.messages.length,
      tracking: input.trackingCount,
      eventsTruncated: input.events.length > events.length,
      messagesTruncated: input.messages.length > messages.length,
    },
  };
}
