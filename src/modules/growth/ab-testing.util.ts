/**
 * توزيع حتمي لتجارب A/B للتسعير اعتمادًا على تجزئة (hash) ثابتة.
 * نفس المستخدم + نفس التجربة => نفس المتغيّر دائمًا.
 */

export interface Variant {
  name: string;
  weight: number;
}

/** FNV-1a 32-bit — تجزئة حتمية مستقرّة عبر العمليات. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** جزء عشري في [0,1) مشتقّ حتميًا من المفتاح + الهدف. */
export function bucketFraction(
  experimentKey: string,
  subjectId: string,
): number {
  return hashString(`${experimentKey}:${subjectId}`) / 0x100000000;
}

export function validateVariants(variants: Variant[]): boolean {
  if (!Array.isArray(variants) || variants.length === 0) return false;
  const names = new Set<string>();
  let sum = 0;
  for (const v of variants) {
    if (!v.name || typeof v.weight !== "number" || v.weight < 0) return false;
    if (names.has(v.name)) return false;
    names.add(v.name);
    sum += v.weight;
  }
  return sum > 0;
}

/**
 * يُعيّن المتغيّر حتميًا حسب الأوزان. يرمي خطأً إذا كانت المتغيّرات غير صالحة.
 */
export function assignVariant(
  experimentKey: string,
  subjectId: string,
  variants: Variant[],
): string {
  if (!validateVariants(variants)) {
    throw new Error("INVALID_VARIANTS");
  }
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  const point = bucketFraction(experimentKey, subjectId) * totalWeight;
  let cumulative = 0;
  for (const v of variants) {
    cumulative += v.weight;
    if (point < cumulative) return v.name;
  }
  return variants[variants.length - 1].name;
}
