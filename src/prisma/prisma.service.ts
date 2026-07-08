import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  // إغلاق اتصال قاعدة البيانات بأمان عند الإيقاف السلس (SIGTERM).
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
