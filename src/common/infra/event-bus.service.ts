import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter } from "events";
import { RedisService } from "../../modules/redis/redis.service";

/**
 * حدث مجال (Domain Event) موحّد. name مثل: catalog.category.updated
 */
export interface DomainEvent<T = unknown> {
  name: string;
  payload: T;
  at: string;
}

export type DomainEventHandler<T = unknown> = (event: DomainEvent<T>) => void;

/**
 * ناقل أحداث خفيف (Event-Driven) دون تبعيات خارجية:
 * - يبث محليّاً داخل العملية (Node EventEmitter) ليستمع إليه أي مستمع (مثل بوابة WebSocket).
 * - ينشر أيضاً عبر Redis Pub/Sub (إن توفّر) لدعم تعدد النسخ (multi-instance) مستقبلاً.
 * لا يُوقف أي عملية إن فشل البث.
 */
@Injectable()
export class EventBusService {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger("EventBus");
  readonly redisChannel = "nova:events";

  constructor(@Optional() private readonly redis?: RedisService) {
    this.emitter.setMaxListeners(200);
  }

  /** إصدار حدث. */
  emit<T>(name: string, payload: T): void {
    const event: DomainEvent<T> = {
      name,
      payload,
      at: new Date().toISOString(),
    };
    try {
      this.emitter.emit(name, event);
      this.emitter.emit("*", event);
    } catch (e) {
      this.logger.warn(`local emit failed: ${(e as Error).message}`);
    }
    if (this.redis) {
      this.redis.client
        .publish(this.redisChannel, JSON.stringify(event))
        .catch(() => undefined);
    }
  }

  /** الاستماع لحدث محدّد. */
  on<T>(name: string, handler: DomainEventHandler<T>): void {
    this.emitter.on(name, handler as DomainEventHandler);
  }

  /** الاستماع لكل الأحداث. */
  onAny(handler: DomainEventHandler): void {
    this.emitter.on("*", handler);
  }
}
