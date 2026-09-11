import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * حارس ثابت: **لا نسبة عمولة مبرمَجة في كود التطبيق**.
 *
 * لماذا اختبار يفحص المصدر: القاعدة التجارية هنا ليست عن مخرجات دالة بل عن
 * *مكان* الرقم. كانت العمولة قبل هذا التصحيح تأتي من
 * `const DEFAULT_COMMISSION_PCT = 15` في محرك التسعير و`@default(15)` في
 * المخطط، ولا يوجد اختبار سلوكي يكشف عودتها لأن النظام يعمل بشكل طبيعي —
 * بنسبة خاطئة. هذا الاختبار يجعل العودة فشلًا صريحًا في CI.
 *
 * ما نمنعه: إسناد نسبة عمولة رقمية حرفية في `src/` أو في `prisma/`
 * (قيمة افتراضية في المخطط أو إدراج في مايغريشن).
 * ما نسمح به: القيم الاختبارية داخل ملفات `*.spec.ts` نفسها، وقراءة
 * النسبة من قاعدة أو إعداد، و`?? null` (أي «لا تجاوز»).
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

/** إسناد نسبة عمولة إلى رقم حرفي: `commissionPct: 15` / `= 0.15` / `commission = 15`. */
const HARD_CODED_PATTERNS: RegExp[] = [
  /commissionPct\s*[:=]\s*-?\d+(\.\d+)?/i,
  /commissionPct\s*\?\?\s*-?\d+(\.\d+)?/i,
  /DEFAULT_COMMISSION[A-Z_]*\s*=\s*-?\d+(\.\d+)?/i,
  /\bconst\s+COMMISSION\w*\s*=\s*-?\d+(\.\d+)?/i,
  /commissionRate\s*[:=]\s*-?\d+(\.\d+)?/i,
];

describe("no hard-coded commission percentage", () => {
  it("contains no literal commission percentage in src/ application code", () => {
    const files = walk(join(REPO_ROOT, "src"), (p) => p.endsWith(".ts")).filter(
      (p) => !p.endsWith(".spec.ts"),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        // التعليقات التوضيحية تشرح القاعدة ولا تُنفّذ.
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*")) return;
        for (const pattern of HARD_CODED_PATTERNS) {
          if (pattern.test(code)) {
            offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}: ${code}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("declares no commission default in the Prisma schema", () => {
    const schema = readFileSync(
      join(REPO_ROOT, "prisma", "schema.prisma"),
      "utf8",
    );
    const offenders = schema
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .filter((line) => /commissionPct/i.test(line))
      .filter((line) => /@default\(/.test(line));
    expect(offenders).toEqual([]);
  });

  /**
   * `0_init` هو خطّ الأساس (baseline) المُطبَّق في الإنتاج بالفعل، ولا يجوز
   * تعديله — تعديل مايغريشن مُطبَّق عملية مدمّرة. النسبة الافتراضية 15
   * الموجودة فيه تُسقَط بمايغريشن لاحق، وهذا ما يتحقّق منه الاختبار الذي
   * يليه. الممنوع هو **إدخال** قيمة افتراضية أو إدراج نسبة في أي مايغريشن
   * جديد بعد خطّ الأساس.
   */
  const BASELINE_MIGRATION = "0_init";

  it("introduces no new commission default or seeded percentage after the baseline", () => {
    const migrations = walk(join(REPO_ROOT, "prisma", "migrations"), (p) =>
      p.endsWith(".sql"),
    ).filter((p) => !p.includes(BASELINE_MIGRATION));
    const offenders: string[] = [];
    for (const file of migrations) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const code = line.trim();
        if (code.startsWith("--")) return;
        // إسقاط قيمة افتراضية قديمة مسموح؛ إنشاء/إدراج واحدة ممنوع.
        if (/DROP\s+DEFAULT/i.test(code)) return;
        if (
          /"?commissionPct"?[^,)]*DEFAULT\s+-?\d+(\.\d+)?/i.test(code) ||
          (/INSERT\s+INTO\s+"?CommissionRule"?/i.test(code) &&
            /\d/.test(code))
        ) {
          offenders.push(`${relative(REPO_ROOT, file)}:${index + 1}: ${code}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("drops the baseline commission defaults on Trip and FareQuote", () => {
    const sql = walk(join(REPO_ROOT, "prisma", "migrations"), (p) =>
      p.endsWith(".sql"),
    )
      .filter((p) => !p.includes(BASELINE_MIGRATION))
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    for (const table of ["Trip", "FareQuote", "VehiclePricingRule"]) {
      expect(
        new RegExp(
          `ALTER TABLE "${table}" ALTER COLUMN "commissionPct" DROP DEFAULT`,
          "i",
        ).test(sql),
      ).toBe(true);
    }
  });
});
