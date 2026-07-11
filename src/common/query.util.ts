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
