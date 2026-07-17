import { DEFAULT_CURRENCY, isBalanced, isValidCurrency } from "./money.util";

describe("isBalanced (توازن القيد المزدوج)", () => {
  it("يقبل قيدًا متوازنًا بسيطًا", () => {
    expect(
      isBalanced([
        { direction: "DEBIT", amount: 100 },
        { direction: "CREDIT", amount: 100 },
      ]),
    ).toBe(true);
  });

  it("يقبل توزيع المبلغ على عدة قيود متوازنة", () => {
    expect(
      isBalanced([
        { direction: "DEBIT", amount: 100 },
        { direction: "CREDIT", amount: 70 },
        { direction: "CREDIT", amount: 30 },
      ]),
    ).toBe(true);
  });

  it("يرفض قيدًا غير متوازن", () => {
    expect(
      isBalanced([
        { direction: "DEBIT", amount: 100 },
        { direction: "CREDIT", amount: 90 },
      ]),
    ).toBe(false);
  });

  it("يرفض قيدًا بسطر واحد", () => {
    expect(isBalanced([{ direction: "DEBIT", amount: 100 }])).toBe(false);
  });

  it("يرفض المبالغ الصفرية أو السالبة", () => {
    expect(
      isBalanced([
        { direction: "DEBIT", amount: 0 },
        { direction: "CREDIT", amount: 0 },
      ]),
    ).toBe(false);
  });

  it("يعالج أخطاء الفاصلة العائمة (مثل 0.1 + 0.2)", () => {
    expect(
      isBalanced([
        { direction: "DEBIT", amount: 0.3 },
        { direction: "CREDIT", amount: 0.1 },
        { direction: "CREDIT", amount: 0.2 },
      ]),
    ).toBe(true);
  });
});

describe("DEFAULT_CURRENCY / isValidCurrency", () => {
  it("العملة الافتراضية رمز ISO-4217 صالح", () => {
    expect(isValidCurrency(DEFAULT_CURRENCY)).toBe(true);
  });

  it("يرفض رموز العملة غير الصالحة", () => {
    expect(isValidCurrency("dz")).toBe(false);
    expect(isValidCurrency("DINAR")).toBe(false);
    expect(isValidCurrency("")).toBe(false);
  });
});
