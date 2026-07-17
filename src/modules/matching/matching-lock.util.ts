/**
 * أدوات نقيّة للمطابقة الموزّعة — بلا اعتماديات (قابلة للاختبار tsx).
 * تحدّد مفاتيح حجز العروض وترشّح المرشّحين غير المحجوزين.
 */

/**
 * مفتاح حجز العرض لسائق (Redis). مساحة اسم مستقلة عن
 * مفتاح الانشغال `driver:{id}:trip` حتى لا يتعارضا.
 */
export function driverOfferKey(driverUserId: string): string {
  return `offer:driver:${driverUserId}`;
}

/**
 * يُرجع المرشّحين غير المحجوزين مع الحفاظ على ترتيبهم الأصلي.
 */
export function filterUnreserved(
  candidateIds: string[],
  reserved: Set<string>,
): string[] {
  return candidateIds.filter((id) => !reserved.has(id));
}
