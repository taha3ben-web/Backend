import { INestApplicationContext, Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { ServerOptions } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { RedisService } from "./modules/redis/redis.service";

/**
 * مُوائم Socket.IO مع Redis Pub/Sub.
 *
 * السبب: عند تشغيل أكثر من نسخة من الخادم خلف Load Balancer
 * (توسّع أفقي)، كل نسخة تملك اتصالاتها. هذا المُوائم يجعل
 * الأحداث (مثل driver:moved / notification) تصل لكل النسخ عبر Redis.
 *
 * إذا لم يتوفر Redis يعود للسلوك الافتراضي (نسخة واحدة).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    try {
      const redis = this.app.get(RedisService);
      const pubClient = redis.duplicate();
      const subClient = redis.duplicate();
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log("Socket.IO Redis adapter مُفعّل (جاهز للتوسّع).");
    } catch (err) {
      this.logger.warn(
        `تعذّر تفعيل Redis adapter؛ يعمل بنسخة واحدة. (${(err as Error).message})`,
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
