import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AssetsService } from "./assets.service";

/**
 * واجهة الأصول العامة ("/api/assets/*") — بلا مصادقة، تعمل كـ CDN خفيف.
 * - GET /api/assets/manifest : قائمة الأصول وإصداراتها (hash) وروابط تنزيلها.
 * - GET /api/assets/file/:key : تنزيل الملف نفسه (JSON للوتي أو glb للنموذج).
 *
 * التطبيق ينزّل هذه الملفات أول مرة، يخزّنها محليًّا، ويعيد التنزيل تلقائيًّا
 * فقط عند تغيّر الـ hash — دون تحديث التطبيق من المتجر.
 */
@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get("manifest")
  manifest(@Req() req: Request) {
    return this.assets.buildManifest(this.baseUrl(req));
  }

  @Get("file/:key")
  file(@Param("key") key: string, @Res() res: Response): void {
    const f = this.assets.getFile(key);
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Content-Length", String(f.bytes));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("ETag", `"${f.hash}"`);
    res.setHeader("X-Asset-Version", f.hash);
    f.stream.on("error", () => {
      if (!res.headersSent) res.status(404).end();
    });
    f.stream.pipe(res);
  }

  /** يبني الرابط الأساسي من الطلب (يحترم البروكسي) أو من PUBLIC_BASE_URL. */
  private baseUrl(req: Request): string {
    const envBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (envBase) return envBase;
    const proto =
      (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() ||
      req.protocol ||
      "https";
    const host = req.get("host");
    return `${proto}://${host}`;
  }
}
