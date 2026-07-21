import { driverOfferKey, filterUnreserved } from "./matching-lock.util";

describe("matching-lock.util (تزامن المطابقة الموزّعة)", () => {
  describe("driverOfferKey", () => {
    it("يبني مفتاحًا محجوزًا في مساحة اسم offer", () => {
      expect(driverOfferKey("driver-1")).toBe("offer:driver:driver-1");
    });

    it("مساحة الاسم مستقلّة عن مفتاح الانشغال (لا تعارض)", () => {
      const offer = driverOfferKey("d9");
      expect(offer.startsWith("offer:driver:")).toBe(true);
      expect(offer).not.toContain(":trip");
    });

    it("يُنتج مفاتيح فريدة لسائقين مختلفين (منع تصادم الحجز)", () => {
      const ids = ["a", "b", "c", "a"];
      const keys = new Set(ids.map(driverOfferKey));
      // ثلاثة معرّفات فريدة فقط
      expect(keys.size).toBe(3);
    });
  });

  describe("filterUnreserved", () => {
    it("يُرجع المرشّحين غير المحجوزين مع الحفاظ على الترتيب", () => {
      const result = filterUnreserved(
        ["d1", "d2", "d3", "d4"],
        new Set(["d2", "d4"]),
      );
      expect(result).toEqual(["d1", "d3"]);
    });

    it("يُرجع قائمة فارغة حين يُحجز الجميع (تزاحم كامل)", () => {
      expect(filterUnreserved(["d1", "d2"], new Set(["d1", "d2"]))).toEqual([]);
    });

    it("يُرجع القائمة كاملة حين لا حجوزات", () => {
      expect(filterUnreserved(["d1", "d2"], new Set())).toEqual(["d1", "d2"]);
    });

    it("محاكاة تزامن: عاملان يحجزان تتابعيًا — لا يحصل أحد على نفس السائق", () => {
      const candidates = ["d1", "d2", "d3"];
      const reserved = new Set<string>();
      // العامل A يأخذ أوّل متاح
      const forA = filterUnreserved(candidates, reserved);
      const pickA = forA[0];
      reserved.add(pickA);
      // العامل B يرى الحجز ويأخذ التالي
      const forB = filterUnreserved(candidates, reserved);
      const pickB = forB[0];
      expect(pickA).toBe("d1");
      expect(pickB).toBe("d2");
      expect(pickA).not.toBe(pickB);
    });
  });
});
