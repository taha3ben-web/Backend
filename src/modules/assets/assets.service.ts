import { Injectable, NotFoundException } from "@nestjs/common";
import { createReadStream, existsSync, readFileSync, statSync, ReadStream } from "fs";
import { createHash } from "crypto";
import { join } from "path";

/**
 * تعريف أصل واحد (رسوم متحركة، نموذج ثلاثي الأبعاد، صورة، أو وسائط).
 * تُخزَّن كل هذه الملفات على الخادم وتُقدَّم كـ CDN بسيط، بحيث ينزّلها
 * التطبيق مرة واحدة عند أول تشغيل ثم يخزّنها محليًّا، ويحدّثها في الخلفية
 * عند تغيّر الإصدار (hash) دون الحاجة لتحديث التطبيق من المتجر.
 */
export interface AssetDef {
  key: string;
  file: string;
  type: "lottie" | "model" | "image" | "media";
  contentType: string;
  /** هل تتكرّر حركة اللوتي (waiting=true، success/rejected=false). */
  loop?: boolean;
}

/**
 * سجلّ الأصول. أضف أي أصل جديد هنا فقط، ثم ضع ملفه داخل مجلد assets/
 * في جذر مشروع الخادم — وسيظهر تلقائيًّا في manifest ويُنزَّل في التطبيق.
 */
const ASSETS: AssetDef[] = [
  {
    key: "waiting",
    file: "waiting.json",
    type: "lottie",
    contentType: "application/json; charset=utf-8",
    loop: true,
  },
  {
    key: "success",
    file: "success.json",
    type: "lottie",
    contentType: "application/json; charset=utf-8",
    loop: false,
  },
  {
    key: "rejected",
    file: "false.json",
    type: "lottie",
    contentType: "application/json; charset=utf-8",
    loop: false,
  },
  {
    key: "locationPin",
    file: "location_pin.glb",
    type: "model",
    contentType: "model/gltf-binary",
  },
];

interface AssetMeta {
  hash: string;
  bytes: number;
  mtimeMs: number;
}

@Injectable()
export class AssetsService {
  private readonly cache = new Map<string, AssetMeta>();

  /** يحدّد مجلد الأصول بشكل قوي مهما كان مكان التشغيل (dist أو الجذر). */
  private resolveDir(): string {
    const candidates = [
      join(process.cwd(), "assets"),
      join(__dirname, "..", "..", "..", "..", "assets"),
      join(__dirname, "..", "..", "..", "assets"),
      join(__dirname, "..", "..", "assets"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return candidates[0];
  }

  private defFor(key: string): AssetDef {
    const def = ASSETS.find((a) => a.key === key);
    if (!def) throw new NotFoundException(`asset not found: ${key}`);
    return def;
  }

  private pathFor(def: AssetDef): string {
    return join(this.resolveDir(), def.file);
  }

  /** يحسب (ويخزّن مؤقتًا) بصمة الملف وحجمه لاكتشاف التحديثات. */
  private meta(def: AssetDef): AssetMeta {
    const path = this.pathFor(def);
    if (!existsSync(path)) {
      throw new NotFoundException(`asset file missing: ${def.file}`);
    }
    const st = statSync(path);
    const cached = this.cache.get(def.key);
    if (cached && cached.mtimeMs === st.mtimeMs) return cached;
    const buf = readFileSync(path);
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    const entry: AssetMeta = { hash, bytes: st.size, mtimeMs: st.mtimeMs };
    this.cache.set(def.key, entry);
    return entry;
  }

  /** يبني قائمة الأصول (manifest) بروابط مطلقة قابلة للتنزيل من التطبيق. */
  buildManifest(baseUrl: string) {
    const base = baseUrl.replace(/\/$/, "");
    const assets = ASSETS.map((def) => {
      const m = this.meta(def);
      return {
        key: def.key,
        type: def.type,
        url: `${base}/api/assets/file/${def.key}`,
        contentType: def.contentType,
        version: m.hash,
        hash: m.hash,
        bytes: m.bytes,
        loop: def.loop ?? false,
      };
    });
    const version = createHash("sha256")
      .update(assets.map((a) => `${a.key}:${a.hash}`).join("|"))
      .digest("hex")
      .slice(0, 16);
    return { version, generatedAt: new Date().toISOString(), assets };
  }

  getFile(key: string): {
    stream: ReadStream;
    contentType: string;
    hash: string;
    bytes: number;
  } {
    const def = this.defFor(key);
    const m = this.meta(def);
    return {
      stream: createReadStream(this.pathFor(def)),
      contentType: def.contentType,
      hash: m.hash,
      bytes: m.bytes,
    };
  }
}
