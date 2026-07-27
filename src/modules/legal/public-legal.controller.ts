import { Controller, Get, Query } from "@nestjs/common";
import { LegalService } from "./legal.service";

/**
 * مسار عام (بدون مصادقة) لتزويد التطبيقات بالمستندات القانونية المنشورة
 * قبل تسجيل الدخول (شاشة الموافقة الأولى).
 */
import { Public } from "../../common/decorators/public.decorator";

// مسارات عامة مقصودة (الحارس العالمي يحمي كل ما عداها).
@Public()
@Controller("public/legal")
export class PublicLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  list(@Query("audience") audience?: string, @Query("locale") locale?: string) {
    return this.legal.publicList(audience, locale);
  }
}
