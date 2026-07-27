import { Controller, Get, Version, VERSION_NEUTRAL } from "@nestjs/common";
import {
  API_ERROR_CODES,
  ApiErrorCode,
  SUPPORTED_LOCALES,
} from "./api-error.util";

/** إصدار API الحالي (يُقرأ من البيئة مع رجوع إلى "1"). */
export const CURRENT_API_VERSION = process.env.API_VERSION?.trim() || "1";

/**
 * نقطة وصف عامّة للموبايل: تُرجع إصدار API، اللغات المدعومة،
 * وفهرس أكواد الأخطاء برسائلها المترجمة، ليبني التطبيق خريطة أخطاء أوفلاين.
 * متاحة بلا مصادقة (معلومات ثابتة غير حسّاسة).
 */
import { Public } from "../decorators/public.decorator";

// مسارات عامة مقصودة (الحارس العالمي يحمي كل ما عداها).
@Public()
@Controller({ path: "meta", version: VERSION_NEUTRAL })
export class ApiMetaController {
  @Get()
  @Version(VERSION_NEUTRAL)
  meta(): {
    apiVersion: string;
    supportedLocales: string[];
    errorCodes: Array<{
      code: ApiErrorCode;
      httpStatus: number;
      messages: Record<string, string>;
    }>;
  } {
    const errorCodes = (Object.keys(API_ERROR_CODES) as ApiErrorCode[]).map(
      (code) => ({
        code,
        httpStatus: API_ERROR_CODES[code].httpStatus,
        messages: API_ERROR_CODES[code].messages,
      }),
    );

    return {
      apiVersion: CURRENT_API_VERSION,
      supportedLocales: [...SUPPORTED_LOCALES],
      errorCodes,
    };
  }
}
