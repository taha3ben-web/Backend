/** أدوات مشتركة للترقيم والترتيب والترشيح (دوال نقية). */

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  return {
    data,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / (limit || 1))),
  };
}

export function skipTake(page = 1, limit = 20): { skip: number; take: number } {
  const p = Math.max(1, page);
  const l = Math.min(100, Math.max(1, limit));
  return { skip: (p - 1) * l, take: l };
}

/**
 * يبني orderBy آمناً: لا يقبل إلا الحقول المسموح بها (منع حقن حقول عشوائية).
 */
export function orderByOf(
  sortBy: string | undefined,
  sortOrder: "asc" | "desc",
  allowed: string[],
  fallback: Array<Record<string, "asc" | "desc">>,
): Array<Record<string, "asc" | "desc">> {
  if (sortBy && allowed.includes(sortBy)) return [{ [sortBy]: sortOrder }];
  return fallback;
}

export function isTrue(v?: string | boolean): boolean {
  return v === true || v === "true" || v === "1";
}

/* -------------------------------------------------------------------------
 * الترقيم بالمؤشر (Cursor pagination)
 *
 * `skip/take` يصبح بطيئًا جدًا على الجداول الكبيرة (رحلات، تتبّع، قيود مالية)
 * لأن قاعدة البيانات تمرّ فعليًا على كل الصفوف المتخطّاة، كما أن `count()` يمسح الجدول.
 * المؤشر يستخدم شرط `WHERE (createdAt, id) < (…)` فيستفيد من الفهرس مباشرة
 * ويبقى زمنه ثابتًا مهما عمُقت الصفحة.
 * ---------------------------------------------------------------------- */

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface CursorPayload {
  /** طابع زمني ISO للعنصر الأخير في الصفحة السابقة. */
  at: string;
  /** معرّف العنصر الأخير (فاصل التعادل لمنع تكرار أو قفز الصفوف المتزامنة). */
  id: string;
}

/** يرمّز المؤشر إلى نص base64url معتم (لا يعتمد عليه العميل داخليًا). */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** يفكّ المؤشر؛ يُرجع null إن كان تالفًا (فتبدأ القراءة من البداية بدل الرمي). */
export function decodeCursor(cursor?: string | null): CursorPayload | null {
  if (!cursor?.trim()) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<CursorPayload>;
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string") {
      return null;
    }
    if (Number.isNaN(Date.parse(parsed.at))) return null;
    return { at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}

/** يضبط حد الصفحة (1..100) مع طلب عنصر إضافي لمعرفة وجود التالي. */
export function cursorTake(limit = 20): { limit: number; take: number } {
  const l = Math.min(100, Math.max(1, limit));
  return { limit: l, take: l + 1 };
}

/**
 * يبني شرط Prisma للمتابعة بعد المؤشر (ترتيب تنازلي: الأحدث أولًا).
 * يُدمج داخل `where` عبر `AND`.
 */
export function cursorWhere(
  cursor: CursorPayload | null,
  field = "createdAt",
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  const at = new Date(cursor.at);
  return {
    OR: [
      { [field]: { lt: at } },
      { AND: [{ [field]: at }, { id: { lt: cursor.id } }] },
    ],
  };
}

/**
 * يقطع العنصر الزائد ويبني المؤشر التالي من آخر عنصر مُعاد.
 */
export function cursorPage<T extends { id: string } & Record<string, unknown>>(
  rows: T[],
  limit: number,
  field = "createdAt",
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const rawAt = last ? last[field] : undefined;
  const at =
    rawAt instanceof Date
      ? rawAt.toISOString()
      : typeof rawAt === "string"
        ? rawAt
        : null;
  return {
    data,
    hasMore,
    limit,
    nextCursor:
      hasMore && last && at ? encodeCursor({ at, id: last.id }) : null,
  };
}
