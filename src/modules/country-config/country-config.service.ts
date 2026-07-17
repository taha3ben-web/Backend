import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DEFAULT_CURRENCY } from "../../common/money.util";
import {
  CountryConfig,
  DEFAULT_COUNTRY_CONFIGS,
  PaymentMethod,
  TaxMode,
  computeTax,
  isValidCountryCode,
  normalizeCountryCode,
  normalizePhoneE164,
  resolveCountryConfig,
} from "./country-config.util";

export interface UpsertCountryConfigInput {
  code: string;
  name?: string;
  currency?: string;
  dialCode?: string;
  nationalNumberLength?: number;
  locale?: string;
  timezone?: string;
  taxRatePct?: number;
  taxMode?: TaxMode;
  paymentMethods?: PaymentMethod[];
  isActive?: boolean;
}

/**
 * خدمة إعدادات البلدان: تدمج التخصيصات المخزّنة في قاعدة البيانات فوق
 * الافتراضات المدمجة (`DEFAULT_COUNTRY_CONFIGS`). المنطق النقي (تطبيع الهاتف،
 * حساب الضريبة) يعيش في `country-config.util` وقابل لاختبار الوحدة.
 */
@Injectable()
export class CountryConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** بناء سجلّ مدمج: الافتراضات ثم تجاوزها بصفوف قاعدة البيانات النشطة. */
  private async buildRegistry(): Promise<Record<string, CountryConfig>> {
    const registry: Record<string, CountryConfig> = {
      ...(DEFAULT_COUNTRY_CONFIGS as Record<string, CountryConfig>),
    };
    const rows = await this.prisma.countryConfig.findMany({
      where: { isActive: true },
    });
    for (const r of rows as any[]) {
      registry[r.code] = {
        code: r.code,
        name: r.name,
        currency: r.currency,
        dialCode: r.dialCode,
        nationalNumberLength: r.nationalNumberLength,
        locale: r.locale,
        timezone: r.timezone,
        taxRatePct: r.taxRatePct,
        taxMode: r.taxMode as TaxMode,
        paymentMethods: (r.paymentMethods ?? []) as PaymentMethod[],
      };
    }
    return registry;
  }

  /** قائمة كل البلدان المدمجة (افتراضي + مخزّن). */
  async list(): Promise<CountryConfig[]> {
    const registry = await this.buildRegistry();
    return Object.values(registry).sort((a, b) => a.code.localeCompare(b.code));
  }

  /** جلب إعداد بلد واحد مع تراجع إلى العملة الافتراضية للنظام. */
  async get(code: string): Promise<CountryConfig> {
    const registry = await this.buildRegistry();
    const cfg = resolveCountryConfig(code, registry);
    if (!cfg) {
      throw new NotFoundException(`Country config not found: ${code}`);
    }
    return cfg;
  }

  /** العملة المعتمدة لبلد (أو الافتراضية المركزية عند الغياب). */
  async currencyFor(code: string): Promise<string> {
    const registry = await this.buildRegistry();
    return resolveCountryConfig(code, registry)?.currency ?? DEFAULT_CURRENCY;
  }

  /** تطبيع رقم هاتف إلى E.164 حسب إعداد البلد. */
  async normalizePhone(code: string, phone: string): Promise<string | null> {
    const cfg = await this.get(code);
    return normalizePhoneE164(phone, cfg);
  }

  /** حساب الضريبة على مبلغ حسب وضع ونسبة ضريبة البلد. */
  async taxFor(code: string, amount: number) {
    const cfg = await this.get(code);
    return computeTax(amount, cfg.taxRatePct, cfg.taxMode);
  }

  /** إنشاء/تحديث إعداد بلد في قاعدة البيانات (يتجاوز الافتراضي). */
  async upsert(input: UpsertCountryConfigInput): Promise<CountryConfig> {
    const code = normalizeCountryCode(input.code);
    if (!isValidCountryCode(code)) {
      throw new NotFoundException(`Invalid country code: ${input.code}`);
    }
    const base =
      resolveCountryConfig(code, DEFAULT_COUNTRY_CONFIGS as any) ??
      ({
        code,
        name: code,
        currency: DEFAULT_CURRENCY,
        dialCode: "",
        nationalNumberLength: 9,
        locale: "en",
        timezone: "UTC",
        taxRatePct: 0,
        taxMode: "EXCLUSIVE" as TaxMode,
        paymentMethods: ["CASH"] as PaymentMethod[],
      } satisfies CountryConfig);

    const data = {
      code,
      name: input.name ?? base.name,
      currency: (input.currency ?? base.currency).toUpperCase(),
      dialCode: input.dialCode ?? base.dialCode,
      nationalNumberLength:
        input.nationalNumberLength ?? base.nationalNumberLength,
      locale: input.locale ?? base.locale,
      timezone: input.timezone ?? base.timezone,
      taxRatePct: input.taxRatePct ?? base.taxRatePct,
      taxMode: (input.taxMode ?? base.taxMode) as string,
      paymentMethods: (input.paymentMethods ??
        base.paymentMethods) as unknown as string[],
      isActive: input.isActive ?? true,
    };

    const row = await this.prisma.countryConfig.upsert({
      where: { code },
      create: data,
      update: data,
    });
    return {
      code: (row as any).code,
      name: (row as any).name,
      currency: (row as any).currency,
      dialCode: (row as any).dialCode,
      nationalNumberLength: (row as any).nationalNumberLength,
      locale: (row as any).locale,
      timezone: (row as any).timezone,
      taxRatePct: (row as any).taxRatePct,
      taxMode: (row as any).taxMode as TaxMode,
      paymentMethods: ((row as any).paymentMethods ?? []) as PaymentMethod[],
    };
  }
}
