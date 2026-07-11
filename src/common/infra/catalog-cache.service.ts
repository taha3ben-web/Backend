import { Injectable } from "@nestjs/common";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  version: number;
}

/**
 * ذاكرة تخزين مؤقت داخل العملية للكتالوج (بلا تبعيات).
 * الفئات/الأنواع/الميزات/الأسعار نادراً ما تتغير، لذا تُخزّن مؤقتاً.
 * أي تعديل يستدعي invalidate() فيرتفع رقم النسخة وتُمسح الذاكرة (تين تلقائياً).
 */
@Injectable()
export class CatalogCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private version = Date.now();
  private readonly defaultTtlMs = 60_000;

  /** رقم نسخة الكتالوج الحالي (يستخدمه العميل لـ smart cache). */
  getVersion(): number {
    return this.version;
  }

  /** يُبطل الذاكرة ويرفع رقم النسخة — يُستدعى عند أي تعديل على الكتالوج. */
  invalidate(): number {
    this.version = Date.now();
    this.store.clear();
    return this.version;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.version !== this.version || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      version: this.version,
    });
  }

  /** يُرجع المخزّن إن وُجد، وإلا يُنتجه ويخزّنه. */
  async wrap<T>(
    key: string,
    ttlMs: number,
    producer: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await producer();
    this.set(key, value, ttlMs);
    return value;
  }
}
