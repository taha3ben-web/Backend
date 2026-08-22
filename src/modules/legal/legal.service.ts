import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AcceptLegalDocumentDto,
  CreateLegalDocumentDto,
  UpdateLegalDocumentDto,
} from "./dto/legal.dto";

type ConsentActor = { userId: string; role?: string };

/**
 * المرحلة هـ — لغة الاحتياط للمستندات القانونية.
 *
 * المستندات مفصولة باللغة (@@unique([type, audience, locale]))، واللوحة لا تضمن
 * ترجمة كل مستند إلى اللغات الثلاث. العربية هي اللغة الافتراضية في
 * schema.prisma (locale String @default("ar"))، فهي لغة الاحتياط هنا أيضًا.
 */
const LEGAL_FALLBACK_LOCALE = "ar";

/**
 * إدارة المستندات القانونية (الخصوصية/الشروط) وموافقة المستخدمين عليها.
 * تُدار المستندات ونشرها بالكامل من لوحة التحكم، وتستهلكها التطبيقات
 * عبر مسار عام + مسار موافقة موثّق لكل مستخدم.
 */
@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  // --------------------------- إدارة اللوحة ---------------------------

  findAll(filters?: { type?: string; audience?: string }) {
    return this.prisma.legalDocument.findMany({
      where: {
        ...(filters?.type ? { type: filters.type as never } : {}),
        ...(filters?.audience ? { audience: filters.audience as never } : {}),
      },
      orderBy: [{ type: "asc" }, { audience: "asc" }, { locale: "asc" }],
    });
  }

  async findOne(id: string) {
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: "desc" }, take: 10 },
        _count: { select: { consents: true } },
      },
    });
    if (!doc) throw new NotFoundException("المستند القانوني غير موجود");
    return doc;
  }

  async create(dto: CreateLegalDocumentDto) {
    const locale = (dto.locale ?? "ar").trim().toLowerCase();
    const audience = (dto.audience ?? "ALL") as never;
    const existing = await this.prisma.legalDocument.findUnique({
      where: {
        type_audience_locale: {
          type: dto.type as never,
          audience,
          locale,
        },
      },
    });
    if (existing) {
      throw new BadRequestException(
        "يوجد مستند بنفس النوع والجمهور واللغة بالفعل",
      );
    }
    return this.prisma.legalDocument.create({
      data: {
        type: dto.type as never,
        audience,
        locale,
        title: dto.title.trim(),
        body: dto.body,
        summary: dto.summary?.trim() || null,
        requiresAcceptance: dto.requiresAcceptance ?? true,
        effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : null,
        status: "DRAFT",
      },
    });
  }

  async update(id: string, dto: UpdateLegalDocumentDto) {
    const doc = await this.requireRow(id);
    const contentChanged =
      (dto.title !== undefined && dto.title.trim() !== doc.title) ||
      (dto.body !== undefined && dto.body !== doc.body);
    return this.prisma.legalDocument.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.summary !== undefined
          ? { summary: dto.summary?.trim() || null }
          : {}),
        ...(dto.requiresAcceptance !== undefined
          ? { requiresAcceptance: dto.requiresAcceptance }
          : {}),
        ...(dto.effectiveAt !== undefined
          ? { effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        // أي تعديل على المحتوى يُعيد الحالة إلى مسودة حتى إعادة النشر
        ...(contentChanged
          ? { status: "DRAFT", version: { increment: 1 } }
          : {}),
      },
    });
  }

  async publish(id: string, actor: ConsentActor) {
    const doc = await this.requireRow(id);
    const nextPublished = doc.publishedVersion + 1;
    const [updated] = await this.prisma.$transaction([
      this.prisma.legalDocument.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          publishedVersion: nextPublished,
          publishedTitle: doc.title,
          publishedBody: doc.body,
          publishedAt: new Date(),
        },
      }),
      this.prisma.legalDocumentVersion.create({
        data: {
          documentId: id,
          version: nextPublished,
          title: doc.title,
          body: doc.body,
          effectiveAt: doc.effectiveAt,
          publishedById: actor.userId,
        },
      }),
    ]);
    return updated;
  }

  listVersions(id: string) {
    return this.prisma.legalDocumentVersion.findMany({
      where: { documentId: id },
      orderBy: { version: "desc" },
    });
  }

  // ------------------------------ عام (تطبيقات) ------------------------------

  /**
   * المرحلة هـ — كان ترشيح اللغة هنا يكسر شاشة الشروط في حالتين:
   *
   *   1) مع locale=fr واللوحة أضافت العربية وحدها → ترشيح صارم يُرجع [] والشاشة
   *      تظهر **فارغة**، مع أن المستند منشور فعلًا.
   *   2) بلا locale واللوحة أضافت ar وfr وen → تُرجَع ثلاث نسخ من نفس المستند
   *      والتطبيق يعرض الشروط **مكررة ثلاث مرات** بلا أي معيار لاختيار واحدة.
   *
   * أي أن الحالتين الممكنتين لتطبيق بثلاث لغات كانتا معطوبتين. الحل: الترشيح
   * يجري في الذاكرة باختيار صف واحد لكل (type, audience): اللغة المطلوبة إن
   * وُجدت، وإلا العربية، وإلا أول متاح. ويُعلَن في الرد أي لغة وُصلِعًا بها
   * (resolvedLocale / isFallbackLocale) حتى يستطيع التطبيق إشعار السائق أن النص
   * معروض بلغة أخرى، ولا يعرض نصًا عربيًا داخل واجهة فرنسية بلا تفسير.
   *
   * لم يُمسّ مسار اللوحة ولا النشر ولا الإصدارات: كلها تعمل أصلًا.
   */
  async publicList(audience?: string, locale?: string) {
    const audiences = this.audienceFilter(audience);
    const requestedLocale = locale ? locale.trim().toLowerCase() : null;
    const rows = await this.prisma.legalDocument.findMany({
      where: {
        status: "PUBLISHED",
        isActive: true,
        ...(audiences ? { audience: { in: audiences as never } } : {}),
      },
      orderBy: [{ type: "asc" }, { locale: "asc" }],
    });
    const picked = this.pickOnePerDocument(rows, requestedLocale);
    return picked.map((r) => ({
      id: r.id,
      type: r.type,
      audience: r.audience,
      locale: r.locale,
      requestedLocale,
      resolvedLocale: r.locale,
      isFallbackLocale:
        requestedLocale !== null && r.locale.toLowerCase() !== requestedLocale,
      title: r.publishedTitle ?? r.title,
      body: r.publishedBody ?? r.body,
      summary: r.summary,
      version: r.publishedVersion,
      requiresAcceptance: r.requiresAcceptance,
      effectiveAt: r.effectiveAt,
      publishedAt: r.publishedAt,
    }));
  }

  // --------------------------- موافقة المستخدم ---------------------------

  /**
   * المرحلة هـ — كانت هذه الدالة تجمع المستندات بكل اللغات، فلو أضافت اللوحة
   * الشروط بـ ar وfr وen لطولب السائق بالموافقة على **نفس المستند ثلاث مرات**
   * قبل أن يدخل التطبيق. الموافقة حقها أن تكون واحدة لكل مستند، لا واحدة
   * لكل ترجمة.
   */
  async pendingForUser(actor: ConsentActor, locale?: string) {
    const audiences = this.roleAudiences(actor.role);
    const allDocs = await this.prisma.legalDocument.findMany({
      where: {
        status: "PUBLISHED",
        isActive: true,
        requiresAcceptance: true,
        audience: { in: audiences as never },
      },
      orderBy: [{ type: "asc" }, { locale: "asc" }],
    });
    const docs = this.pickOnePerDocument(
      allDocs,
      locale ? locale.trim().toLowerCase() : null,
    );
    if (docs.length === 0) return { pending: [], accepted: [] };
    const consents = await this.prisma.userConsent.findMany({
      where: {
        userId: actor.userId,
        documentId: { in: docs.map((d) => d.id) },
      },
    });
    const acceptedByDoc = new Map<string, number>();
    for (const c of consents) {
      const prev = acceptedByDoc.get(c.documentId) ?? -1;
      if (c.version > prev) acceptedByDoc.set(c.documentId, c.version);
    }
    const pending: Array<Record<string, unknown>> = [];
    const accepted: Array<Record<string, unknown>> = [];
    for (const d of docs) {
      const acceptedVersion = acceptedByDoc.get(d.id) ?? null;
      const entry = {
        id: d.id,
        type: d.type,
        audience: d.audience,
        title: d.publishedTitle ?? d.title,
        version: d.publishedVersion,
        acceptedVersion,
        effectiveAt: d.effectiveAt,
      };
      if (acceptedVersion === d.publishedVersion) accepted.push(entry);
      else pending.push(entry);
    }
    return { pending, accepted };
  }

  async accept(
    id: string,
    actor: ConsentActor,
    dto: AcceptLegalDocumentDto,
    meta: { ip?: string; userAgent?: string },
  ) {
    const doc = await this.requireRow(id);
    if (doc.status !== "PUBLISHED" || doc.publishedVersion < 1) {
      throw new BadRequestException("لا يمكن الموافقة على مستند غير منشور");
    }
    if (dto.version !== undefined && dto.version !== doc.publishedVersion) {
      throw new BadRequestException(
        "إصدار المستند غير مطابق للإصدار المنشور الحالي",
      );
    }
    const versionRow = await this.prisma.legalDocumentVersion.findUnique({
      where: {
        documentId_version: { documentId: id, version: doc.publishedVersion },
      },
    });
    const consent = await this.prisma.userConsent.upsert({
      where: {
        userId_documentId_version: {
          userId: actor.userId,
          documentId: id,
          version: doc.publishedVersion,
        },
      },
      create: {
        userId: actor.userId,
        documentId: id,
        documentVersionId: versionRow?.id ?? null,
        version: doc.publishedVersion,
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ? meta.userAgent.slice(0, 400) : null,
        source: dto.source?.trim() || null,
      },
      update: {},
    });
    return {
      ok: true,
      consentId: consent.id,
      documentId: id,
      version: consent.version,
    };
  }

  // ------------------------------ مساعدات ------------------------------

  /**
   * المرحلة هـ — صف واحد لكل مستند (type + audience) بحسب اللغة.
   *
   * الأفضلية: اللغة المطلوبة → العربية (الافتراضية) → أول متاح.
   * الترتيب ثابت لأن الاستعلام مرتّب بـ type ثم locale، فلا يختلف الردّ بين طلبين.
   */
  private pickOnePerDocument<T extends { locale: string }>(
    rows: T[],
    requestedLocale: string | null,
  ): T[] {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const r = row as unknown as { type: unknown; audience: unknown };
      const key = `${String(r.type)}:${String(r.audience)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    const out: T[] = [];
    for (const bucket of groups.values()) {
      const exact = requestedLocale
        ? bucket.find((r) => r.locale.toLowerCase() === requestedLocale)
        : undefined;
      const fallback = bucket.find(
        (r) => r.locale.toLowerCase() === LEGAL_FALLBACK_LOCALE,
      );
      const chosen = exact ?? fallback ?? bucket[0];
      if (chosen) out.push(chosen);
    }
    return out;
  }

  private roleAudiences(role?: string) {
    if (role === "DRIVER") return ["ALL", "DRIVER"];
    if (role === "PASSENGER") return ["ALL", "PASSENGER"];
    return ["ALL"];
  }

  private audienceFilter(audience?: string) {
    if (!audience) return undefined;
    const a = audience.trim().toUpperCase();
    if (a === "DRIVER") return ["ALL", "DRIVER"];
    if (a === "PASSENGER") return ["ALL", "PASSENGER"];
    return ["ALL"];
  }

  private async requireRow(id: string) {
    const row = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("المستند القانوني غير موجود");
    return row;
  }
}
