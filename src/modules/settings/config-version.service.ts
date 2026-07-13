import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

const VERSION_KEY = "system.configVersion";

@Injectable()
export class ConfigVersionService {
  constructor(private readonly prisma: PrismaService) {}

  async bump(): Promise<number> {
    const version = Date.now();
    await this.prisma.setting.upsert({
      where: { key: VERSION_KEY },
      update: {
        value: version,
        group: "system",
        isPublic: false,
        isSensitive: false,
        version: { increment: 1 },
      },
      create: {
        key: VERSION_KEY,
        value: version,
        group: "system",
        isPublic: false,
        isSensitive: false,
      },
    });
    return version;
  }

  async current(): Promise<number> {
    const row = await this.prisma.setting.findUnique({
      where: { key: VERSION_KEY },
      select: { value: true },
    });
    return typeof row?.value === "number" ? row.value : 0;
  }
}
