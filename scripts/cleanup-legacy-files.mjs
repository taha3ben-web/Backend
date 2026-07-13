import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// ملفات قديمة من نسخة SafetyIncident لم يعد لها نموذج Prisma في المخطط الحالي.
// حذفها قبل البناء يمنع TypeScript من التقاطها إذا بقيت في المستودع بعد نسخ تحديث جزئي.
const legacyFiles = [
  "src/modules/emergency/safety.controller.ts",
  "src/modules/emergency/safety.service.ts",
  "src/modules/emergency/dto/safety.dto.ts",
];

for (const relativePath of legacyFiles) {
  const absolutePath = resolve(process.cwd(), relativePath);
  if (existsSync(absolutePath)) {
    rmSync(absolutePath, { force: true });
    console.log(`[prebuild] removed legacy file: ${relativePath}`);
  }
}
