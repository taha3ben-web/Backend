/**
 * اختبارات ثوابت دفتر الأستاذ (Ledger Invariants) — تعمل دون قاعدة بيانات.
 *
 * تُحاكي هذه المحاكاة قواعد الترحيل الفعلية في `FinancialService.post()`:
 *  - الرصيد يتحرّك +amount عند CREDIT و−amount عند DEBIT (بشكل موحّد).
 *  - رفض القيود غير المتوازنة (مجموع DEBIT ≠ مجموع CREDIT بالوحدات الصغرى).
 *  - رفض المبالغ غير الموجبة ورموز العملة غير الصالحة.
 *  - عدم التكرار (idempotency) عبر idempotencyKey — حتى تحت التزامن.
 *
 * الهدف تثبيت العقد (contract) الذي تضمنه قاعدة البيانات فعليًا عبر قيد
 * التفرّد على idempotencyKey + عزل Serializable؛ أمّا الاختبار المقابل على
 * قاعدة بيانات حقيقية ففي `financial.integration.spec.ts`.
 */

type Direction = "DEBIT" | "CREDIT";

interface PostingLine {
  account: string;
  direction: Direction;
  amount: number;
}

interface LedgerCommand {
  idempotencyKey: string;
  currency: string;
  lines: PostingLine[];
}

const MONEY_SCALE = 100;
const toMinor = (n: number): number => Math.round(n * MONEY_SCALE);

class InMemoryLedger {
  private readonly balancesMinor = new Map<string, number>();
  private readonly txByKey = new Map<string, { id: string }>();
  private seq = 0;
  committedCount = 0;

  private assertCurrency(currency: string): void {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Invalid currency: ${currency}`);
    }
  }

  private assertBalanced(lines: PostingLine[]): void {
    const debit = lines
      .filter((l) => l.direction === "DEBIT")
      .reduce((sum, l) => sum + toMinor(l.amount), 0);
    const credit = lines
      .filter((l) => l.direction === "CREDIT")
      .reduce((sum, l) => sum + toMinor(l.amount), 0);
    if (debit !== credit) {
      throw new Error("Unbalanced ledger transaction");
    }
  }

  /** يحاكي `FinancialService.post()`: تحقق → (حد التزامن) → ترحيل مرة واحدة. */
  async post(cmd: LedgerCommand): Promise<{ id: string }> {
    this.assertCurrency(cmd.currency);
    this.assertBalanced(cmd.lines);
    for (const line of cmd.lines) {
      if (!Number.isFinite(line.amount) || toMinor(line.amount) <= 0) {
        throw new Error("Ledger amount must be positive");
      }
    }

    // مرحلة القراءة (مثل findUnique).
    const existing = this.txByKey.get(cmd.idempotencyKey);
    if (existing) return existing;

    // حد التزامن: يسمح بتداخل مستدعيين متوازيين (await مثل الـ DB).
    await Promise.resolve();

    // مرحلة الكتابة: قيد التفرّد يمنع ازدواج الترحيل (مثل @unique).
    const raced = this.txByKey.get(cmd.idempotencyKey);
    if (raced) return raced;

    const tx = { id: `tx_${++this.seq}` };
    this.txByKey.set(cmd.idempotencyKey, tx);
    for (const line of cmd.lines) {
      const deltaMinor =
        line.direction === "CREDIT" ? toMinor(line.amount) : -toMinor(line.amount);
      this.balancesMinor.set(
        line.account,
        (this.balancesMinor.get(line.account) ?? 0) + deltaMinor,
      );
    }
    this.committedCount += 1;
    return tx;
  }

  balance(account: string): number {
    return (this.balancesMinor.get(account) ?? 0) / MONEY_SCALE;
  }

  /** مجموع كل الأرصدة — يجب أن يبقى صفرًا (حفظ القيمة في القيد المزدوج). */
  totalBalance(): number {
    let sum = 0;
    for (const v of this.balancesMinor.values()) sum += v;
    return sum / MONEY_SCALE;
  }
}

describe("ledger invariants (in-memory double-entry)", () => {
  const settleLines = (): PostingLine[] => [
    { account: "platform:cash", direction: "DEBIT", amount: 100 },
    { account: "driver:1", direction: "CREDIT", amount: 80 },
    { account: "platform:revenue", direction: "CREDIT", amount: 20 },
  ];

  it("applies +CREDIT / -DEBIT and conserves total balance (sum = 0)", async () => {
    const ledger = new InMemoryLedger();
    await ledger.post({
      idempotencyKey: "trip:settle:1",
      currency: "USD",
      lines: settleLines(),
    });
    expect(ledger.balance("platform:cash")).toBe(-100);
    expect(ledger.balance("driver:1")).toBe(80);
    expect(ledger.balance("platform:revenue")).toBe(20);
    expect(ledger.totalBalance()).toBe(0);
    expect(ledger.committedCount).toBe(1);
  });

  it("rejects an unbalanced transaction", async () => {
    const ledger = new InMemoryLedger();
    await expect(
      ledger.post({
        idempotencyKey: "bad:1",
        currency: "USD",
        lines: [
          { account: "a", direction: "DEBIT", amount: 100 },
          { account: "b", direction: "CREDIT", amount: 90 },
        ],
      }),
    ).rejects.toThrow("Unbalanced");
    expect(ledger.committedCount).toBe(0);
  });

  it("rejects non-positive amounts and invalid currencies", async () => {
    const ledger = new InMemoryLedger();
    await expect(
      ledger.post({
        idempotencyKey: "zero:1",
        currency: "USD",
        lines: [
          { account: "a", direction: "DEBIT", amount: 0 },
          { account: "b", direction: "CREDIT", amount: 0 },
        ],
      }),
    ).rejects.toThrow("positive");
    await expect(
      ledger.post({
        idempotencyKey: "cur:1",
        currency: "usd",
        lines: settleLines(),
      }),
    ).rejects.toThrow("Invalid currency");
  });

  it("is idempotent when the same key is posted twice sequentially", async () => {
    const ledger = new InMemoryLedger();
    const cmd = {
      idempotencyKey: "trip:settle:1",
      currency: "USD",
      lines: settleLines(),
    };
    await ledger.post(cmd);
    await ledger.post(cmd);
    expect(ledger.committedCount).toBe(1);
    expect(ledger.balance("driver:1")).toBe(80);
  });

  it("commits exactly once under concurrent duplicate posts (race)", async () => {
    const ledger = new InMemoryLedger();
    const cmd = {
      idempotencyKey: "trip:settle:1",
      currency: "USD",
      lines: settleLines(),
    };
    await Promise.all([ledger.post(cmd), ledger.post(cmd), ledger.post(cmd)]);
    expect(ledger.committedCount).toBe(1);
    expect(ledger.balance("driver:1")).toBe(80);
    expect(ledger.totalBalance()).toBe(0);
  });
});
