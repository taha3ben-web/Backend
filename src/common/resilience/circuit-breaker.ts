/**
 * قاطع دائرة (Circuit Breaker) + مهلة زمنية — بلا تبعيات خارجية.
 *
 * يحمي النداءات الخارجية (OSRM/Firebase/Chargily/Twilio) من التعليق ومن
 * الفشل المتتالي: بعد عدد إخفاقات متتالية تُفتح الدائرة فتُرفض النداءات فورًا
 * مدة `resetTimeoutMs`، ثم تُجرّب محاولة "نصف-مفتوحة" واحدة قبل الإغلاق.
 *
 * الساعة `now` قابلة للحقن لجعل الانتقالات الزمنية قابلة للاختبار بدقة.
 */

export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class CircuitOpenError extends Error {
  constructor(message = "Circuit is open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** اسم للتشخيص والتسجيل. */
  name?: string;
  /** مهلة كل نداء بالمللي ثانية (0 = بلا مهلة). */
  timeoutMs?: number;
  /** عدد الإخفاقات المتتالية التي تفتح الدائرة. */
  failureThreshold?: number;
  /** مدة بقاء الدائرة مفتوحة قبل المحاولة نصف-المفتوحة. */
  resetTimeoutMs?: number;
  /** ساعة قابلة للحقن (للاختبار). */
  now?: () => number;
}

/** يسابق وعدًا بمهلة زمنية؛ يرفض بـ TimeoutError عند التجاوز. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  name = "operation",
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`${name} exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly name: string;
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name ?? "circuit";
    this.timeoutMs = options.timeoutMs ?? 0;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 5);
    this.resetTimeoutMs = Math.max(1, options.resetTimeoutMs ?? 30_000);
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  private maybeHalfOpen(): void {
    if (
      this.state === "open" &&
      this.now() - this.openedAt >= this.resetTimeoutMs
    ) {
      this.state = "half_open";
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (
      this.state === "half_open" ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  /** ينفّذ الدالة عبر القاطع؛ يرفض بـ CircuitOpenError عندما تكون مفتوحة. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();
    if (this.state === "open") {
      throw new CircuitOpenError(`circuit "${this.name}" is open`);
    }
    try {
      const result = await withTimeout(fn(), this.timeoutMs, this.name);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
}
