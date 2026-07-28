import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, of, throwError } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { IDEMPOTENCY_REQUIRED } from "./require-idempotency.decorator";

/**
 * معترض Idempotency-Key على مستوى HTTP — بلا تبعيات خارجية.
 *
 * السلوك آمن ومتوافق رجعيًا:
 *  - يتجاهل GET/HEAD/OPTIONS تمامًا.
 *  - إن لم تُرسل ترويسة `Idempotency-Key` يمرّ الطلب دون تغيير (سلوك أصلي)،
 *    إلا إذا كان المسار معلّمًا بـ @RequireIdempotency والإلزام مُفعّل (IDEMPOTENCY_ENFORCE=true).
 *  - عند وجود مفتاح: أول طلب يُنفّذ ويُخزَّن ردّه؛ وأي تكرار بنفس (المستخدم +
 *    الطريقة + المسار + المفتاح) خلال TTL يُعيد الرد المخزَّن دون إعادة التنفيذ.
 *  - إن كان طلب بنفس المفتاح ما زال قيد التنفيذ يُردّ 409 (تعارض) بدل الازدواج.
 *
 * ملاحظة: هذا التخزين داخل الذاكرة وطبقة حماية سريعة فقط؛ المصدر النهائي
 * لعدم التكرار المالي يبقى قيد التفرّد على idempotencyKey داخل قاعدة البيانات
 * مع عزل Serializable في طبقة دفتر الأستاذ.
 */

interface CacheEntry {
  status: "in_flight" | "done";
  expiresAt: number;
  response?: unknown;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(private readonly reflector: Reflector) {
    const raw = Number(process.env.IDEMPOTENCY_TTL_MS);
    this.ttlMs = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const req = context.switchToHttp().getRequest();
    const method = String(req.method ?? "").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next.handle();
    }

    const rawKey = req.headers ? req.headers["idempotency-key"] : undefined;
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!key || typeof key !== "string") {
      // مسار معلّم بـ @RequireIdempotency: نُلزم بالمفتاح فقط عند تفعيل العلم،
      // حتى لا نكسر عملاء لم يُحدّثوا بعد. بدون التفعيل يبقى تمريرًا آمنًا.
      const required =
        this.reflector.getAllAndOverride<boolean>(IDEMPOTENCY_REQUIRED, [
          context.getHandler(),
          context.getClass(),
        ]) ?? false;
      if (required && IdempotencyInterceptor.isEnforced()) {
        return throwError(
          () =>
            new BadRequestException(
              "Idempotency-Key header is required for this operation",
            ),
        );
      }
      return next.handle();
    }

    this.sweep();
    const actor = req.user?.userId ?? req.user?.id ?? "anon";
    const path = req.originalUrl ?? req.url ?? "";
    const cacheKey = `${actor}:${method}:${path}:${key}`;

    const existing = this.store.get(cacheKey);
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.status === "in_flight") {
        return throwError(
          () =>
            new ConflictException(
              "A request with the same Idempotency-Key is already in progress",
            ),
        );
      }
      return of(existing.response);
    }

    this.store.set(cacheKey, {
      status: "in_flight",
      expiresAt: Date.now() + this.ttlMs,
    });

    return next.handle().pipe(
      tap((response) => {
        this.store.set(cacheKey, {
          status: "done",
          expiresAt: Date.now() + this.ttlMs,
          response,
        });
      }),
      catchError((err) => {
        // عند الفشل نُزيل القفل حتى يُعاد المحاولة بنفس المفتاح.
        this.store.delete(cacheKey);
        return throwError(() => err);
      }),
    );
  }

  /** هل الإلزام مُفعّل عبر البيئة؟ يُقرأ وقت الطلب ليسهل ضبطه دون إعادة إقلاع. */
  private static isEnforced(): boolean {
    return (
      String(process.env.IDEMPOTENCY_ENFORCE ?? "").trim().toLowerCase() ===
      "true"
    );
  }

  /** تنظيف كسول للمدخلات المنتهية لمنع نمو الذاكرة. */
  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (v.expiresAt <= now) this.store.delete(k);
    }
  }
}
