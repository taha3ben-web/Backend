import {
  CommissionRuleCandidate,
  commissionRuleMatches,
  commissionRuleSpecificity,
  isValidCommissionPct,
  pickCommissionRule,
} from "./commission-resolution.util";

/**
 * حلّ نسبة العمولة من إعدادات لوحة التحكم.
 *
 * ملاحظة مقصودة: كل النسب في هذه الاختبارات قيم **اختبارية** تُبنى في
 * الاختبار نفسه، لا قيم افتراضية للنظام. النظام لا يملك أي نسبة افتراضية:
 * `pickCommissionRule` تُرجع null عند غياب القاعدة ولا تخترع رقمًا.
 */
const rule = (
  over: Partial<CommissionRuleCandidate> & { id: string; commissionPct: number },
): CommissionRuleCandidate => ({
  countryCode: null,
  cityId: null,
  vehicleTypeId: null,
  vehicleCategoryId: null,
  priority: 0,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

describe("commission resolution — Dashboard configured, never hard-coded", () => {
  it("returns null when nothing is configured (no invented default)", () => {
    expect(
      pickCommissionRule([], {
        countryCode: "DZ",
        cityId: "city-medea",
        vehicleTypeId: "type-car",
        vehicleCategoryId: "cat-economy",
      }),
    ).toBeNull();
  });

  it("treats a null dimension as a wildcard and a set dimension as a filter", () => {
    const global = rule({ id: "global", commissionPct: 10 });
    const dzOnly = rule({ id: "dz", countryCode: "DZ", commissionPct: 12 });

    expect(commissionRuleMatches(global, { countryCode: "TN" })).toBe(true);
    expect(commissionRuleMatches(dzOnly, { countryCode: "TN" })).toBe(false);
    // بُعد غير محدَّد في السياق لا يُطابق قاعدة تُقيّده.
    expect(commissionRuleMatches(dzOnly, {})).toBe(false);
  });

  it("ignores inactive rules entirely", () => {
    const off = rule({
      id: "off",
      countryCode: "DZ",
      commissionPct: 30,
      isActive: false,
    });
    const on = rule({ id: "on", countryCode: "DZ", commissionPct: 11 });
    const picked = pickCommissionRule([off, on], { countryCode: "DZ" });
    expect(picked?.id).toBe("on");
  });

  it("lets a city rule override a broader country rule", () => {
    const country = rule({ id: "dz", countryCode: "DZ", commissionPct: 18 });
    const city = rule({
      id: "medea",
      countryCode: "DZ",
      cityId: "city-medea",
      commissionPct: 13,
    });
    const picked = pickCommissionRule([country, city], {
      countryCode: "DZ",
      cityId: "city-medea",
    });
    expect(picked?.id).toBe("medea");
    // ونفس القاعدة الأوسع تفوز في مدينة أخرى غير مُغطّاة.
    expect(
      pickCommissionRule([country, city], {
        countryCode: "DZ",
        cityId: "city-algiers",
      })?.id,
    ).toBe("dz");
  });

  it("resolves a vehicle-type rule over a vehicle-category rule", () => {
    const category = rule({
      id: "cat",
      vehicleCategoryId: "cat-economy",
      commissionPct: 16,
    });
    const type = rule({
      id: "type",
      vehicleTypeId: "type-car",
      commissionPct: 14,
    });
    const picked = pickCommissionRule([category, type], {
      vehicleTypeId: "type-car",
      vehicleCategoryId: "cat-economy",
    });
    expect(picked?.id).toBe("type");
    expect(commissionRuleSpecificity(type)).toBeGreaterThan(
      commissionRuleSpecificity(category),
    );
  });

  it("prefers the most specific country+city+category rule", () => {
    const broad = rule({
      id: "broad",
      countryCode: "DZ",
      cityId: "city-algiers",
      commissionPct: 15,
    });
    const exact = rule({
      id: "exact",
      countryCode: "DZ",
      cityId: "city-algiers",
      vehicleCategoryId: "cat-comfort",
      commissionPct: 17,
    });
    expect(
      pickCommissionRule([broad, exact], {
        countryCode: "DZ",
        cityId: "city-algiers",
        vehicleCategoryId: "cat-comfort",
      })?.id,
    ).toBe("exact");
  });

  it("lets an explicit priority beat specificity (admin override)", () => {
    const specific = rule({
      id: "specific",
      countryCode: "DZ",
      cityId: "city-oran",
      vehicleTypeId: "type-car",
      commissionPct: 20,
    });
    const campaign = rule({
      id: "campaign",
      countryCode: "DZ",
      commissionPct: 5,
      priority: 100,
    });
    expect(
      pickCommissionRule([specific, campaign], {
        countryCode: "DZ",
        cityId: "city-oran",
        vehicleTypeId: "type-car",
      })?.id,
    ).toBe("campaign");
  });

  it("is deterministic for equally ranked rules (oldest first, then id)", () => {
    const a = rule({
      id: "b-newer",
      countryCode: "DZ",
      commissionPct: 9,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    const b = rule({
      id: "a-older",
      countryCode: "DZ",
      commissionPct: 8,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(pickCommissionRule([a, b], { countryCode: "DZ" })?.id).toBe(
      "a-older",
    );
    // نفس النتيجة مهما كان ترتيب الإدخال.
    expect(pickCommissionRule([b, a], { countryCode: "DZ" })?.id).toBe(
      "a-older",
    );
  });

  it("normalizes country codes case-insensitively", () => {
    const dz = rule({ id: "dz", countryCode: "dz", commissionPct: 12 });
    expect(commissionRuleMatches(dz, { countryCode: "DZ" })).toBe(true);
    expect(commissionRuleMatches(dz, { countryCode: " dz " })).toBe(true);
  });

  it("rejects percentages outside 0..100 and non-numbers", () => {
    expect(isValidCommissionPct(0)).toBe(true);
    expect(isValidCommissionPct(100)).toBe(true);
    expect(isValidCommissionPct(-1)).toBe(false);
    expect(isValidCommissionPct(101)).toBe(false);
    expect(isValidCommissionPct(Number.NaN)).toBe(false);
    expect(isValidCommissionPct("15")).toBe(false);
    expect(isValidCommissionPct(null)).toBe(false);
  });

  it("keeps a settled trip's rate stable when the Dashboard rule changes", () => {
    // لقطة الرحلة: النسبة التي حُلّت وقت الطلب وخُزّنت على الرحلة.
    const atSettlement = pickCommissionRule(
      [rule({ id: "r1", countryCode: "DZ", commissionPct: 15 })],
      { countryCode: "DZ" },
    );
    const tripSnapshot = {
      commissionPct: atSettlement?.commissionPct as number,
      commissionRuleId: atSettlement?.id ?? null,
      commissionAmount: (1000 * (atSettlement?.commissionPct as number)) / 100,
    };
    expect(tripSnapshot.commissionAmount).toBe(150);

    // اللوحة تغيّر القاعدة نفسها لاحقًا إلى 12%.
    const afterChange = pickCommissionRule(
      [
        rule({
          id: "r1",
          countryCode: "DZ",
          commissionPct: 12,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ],
      { countryCode: "DZ" },
    );
    expect(afterChange?.commissionPct).toBe(12);
    // اللقطة التاريخية لا تُعاد كتابتها: الرحلة تبقى 150 دج.
    expect(tripSnapshot.commissionPct).toBe(15);
    expect(tripSnapshot.commissionAmount).toBe(150);
  });
});
