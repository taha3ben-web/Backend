import { HttpException } from "@nestjs/common";
import {
  ApiErrorCode,
  httpStatusForCode,
} from "./api-error.util";

/**
 * استثناء تطبيقي يحمل كود خطأ موحّدًا (`ApiErrorCode`) بدل نص مجرّد،
 * ليقرأه تطبيق الموبايل برمجيًا. الرسالة تُترجم في المُرّشّح حسب `Accept-Language`.
 *
 * @example throw new AppException("INSUFFICIENT_BALANCE");
 * @example throw new AppException("RISK_BLOCKED", { details: reasons });
 */
export class AppException extends HttpException {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  /** رسالة صريحة تتجاوز الترجمة الافتراضية (اختياري). */
  readonly messageOverride?: string;

  constructor(
    code: ApiErrorCode,
    options?: { details?: unknown; message?: string },
  ) {
    super(options?.message ?? code, httpStatusForCode(code));
    this.code = code;
    this.details = options?.details;
    this.messageOverride = options?.message;
  }
}
