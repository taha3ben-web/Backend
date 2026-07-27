import { joinPublicUrl, normalizeObjectPath } from "./storage.driver";

describe("storage driver helpers", () => {
  it("ينزع الشرطة البادئة من مسار الكائن", () => {
    expect(normalizeObjectPath("/invoices/u1/FG-1.pdf")).toBe(
      "invoices/u1/FG-1.pdf",
    );
  });

  it("يقبل المسار العادي دون تغيير", () => {
    expect(normalizeObjectPath("driver-docs/d1/licence-1.jpg")).toBe(
      "driver-docs/d1/licence-1.jpg",
    );
  });

  it("يرفض المسار الفارغ", () => {
    expect(() => normalizeObjectPath("   ")).toThrow(
      "STORAGE_OBJECT_PATH_EMPTY",
    );
  });

  it("يرفض محاولة الخروج من المجلّد (path traversal)", () => {
    expect(() => normalizeObjectPath("a/../../secret.txt")).toThrow(
      "STORAGE_OBJECT_PATH_INVALID",
    );
  });

  it("يبني رابطًا عامًا دون شرطات مكررة", () => {
    expect(joinPublicUrl("https://cdn.example.com/", "/a/b.png")).toBe(
      "https://cdn.example.com/a/b.png",
    );
  });

  it("يشفر المقاطع التي بها مسافات دون تشفير الشرطات", () => {
    expect(
      joinPublicUrl("https://cdn.example.com", "mobile-assets/a b.png"),
    ).toBe("https://cdn.example.com/mobile-assets/a%20b.png");
  });
});
