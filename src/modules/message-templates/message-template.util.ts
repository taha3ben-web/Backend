/**
 * منطق نقي لقوالب الرسائل (Message Templates): استخراج المتغيّرات،
 * والتحقّق من صحة الصياغة، وتعبئة القالب بالقيم. بلا اعتماد على
 * قاعدة بيانات أو NestJS — قابل لاختبارات الوحدة. لا يحتوي أي تسعير أو خصم.
 */

export type TemplateLocale = "ar" | "en" | "fr";
export const TEMPLATE_LOCALES: TemplateLocale[] = ["ar", "en", "fr"];
export const DEFAULT_TEMPLATE_LOCALE: TemplateLocale = "ar";

/** نمط المتغيّر داخل القالب: {{ varName }} (حروف/أرقام/شرطة سفلية/نقطة). */
export const TEMPLATE_VAR_SOURCE = "\\{\\{\\s*([a-zA-Z0-9_.]+)\\s*\\}\\}";

function pattern(): RegExp {
  return new RegExp(TEMPLATE_VAR_SOURCE, "g");
}

export function normalizeLocale(locale?: string | null): TemplateLocale {
  const v = (locale ?? "").trim().toLowerCase();
  return v === "en" || v === "fr" || v === "ar" ? v : DEFAULT_TEMPLATE_LOCALE;
}

/** يستخرج أسماء المتغيّرات الفريدة المستعملة داخل النص (بترتيب الظهور). */
export function extractVariables(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const re = pattern();
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]);
  }
  return Array.from(out);
}

export interface RenderResult {
  text: string;
  missing: string[];
}

/**
 * يعبّئ النص بقيم المتغيّرات. المتغيّر غير المتوفّر يبقى ظاهرًا كما هو
 * ({{name}}) ويُدرَج في missing، حتى لا تُرسَل رسالة ناقصة صامتة.
 */
export function renderTemplate(
  text: string,
  vars: Record<string, unknown> = {},
): RenderResult {
  if (typeof text !== "string" || text.length === 0) {
    return { text: typeof text === "string" ? text : "", missing: [] };
  }
  const source = vars ?? {};
  const missing = new Set<string>();
  const rendered = text.replace(pattern(), (_full, key: string) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      return value == null ? "" : String(value);
    }
    missing.add(key);
    return "{{" + key + "}}";
  });
  return { text: rendered, missing: Array.from(missing) };
}

export interface RenderedMessage {
  title: string;
  body: string;
  missing: string[];
}

/** يعبّئ العنوان والنص معًا ويجمع المتغيّرات الناقصة من كليهما. */
export function renderMessage(
  title: string,
  body: string,
  vars: Record<string, unknown> = {},
): RenderedMessage {
  const t = renderTemplate(title, vars);
  const b = renderTemplate(body, vars);
  const missing = Array.from(new Set([...t.missing, ...b.missing]));
  return { title: t.text, body: b.text, missing };
}

export interface TemplateValidation {
  valid: boolean;
  errors: string[];
}

/** تحقّق سريع من صياغة القالب: توازن الأقواس ووجود متغيّرات فارغة. */
export function validateTemplateSyntax(text: string): TemplateValidation {
  const errors: string[] = [];
  if (typeof text !== "string") {
    return { valid: false, errors: ["INVALID_TYPE"] };
  }
  const opens = (text.match(/\{\{/g) ?? []).length;
  const closes = (text.match(/\}\}/g) ?? []).length;
  if (opens !== closes) errors.push("UNBALANCED_BRACES");
  if (/\{\{\s*\}\}/.test(text)) errors.push("EMPTY_PLACEHOLDER");
  return { valid: errors.length === 0, errors };
}

/** يوحّد قائمة المتغيّرات المُعلنة مع ما هو مستعمل فعليًا في العنوان والنص. */
export function resolveDeclaredVariables(
  title: string,
  body: string,
  declared?: string[] | null,
): string[] {
  const used = new Set<string>([
    ...extractVariables(title),
    ...extractVariables(body),
  ]);
  if (Array.isArray(declared)) {
    for (const d of declared) {
      const v = typeof d === "string" ? d.trim() : "";
      if (v) used.add(v);
    }
  }
  return Array.from(used);
}
