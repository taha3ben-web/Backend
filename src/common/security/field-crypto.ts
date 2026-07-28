import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * تشفير الحقول الحساسة على مستوى التطبيق (IBAN / بيانات KYC ...).
 *
 * تصميم متوافق رجعيًا وآمن للتفعيل التدريجي:
 * - إن لم يُضبط FIELD_ENCRYPTION_KEY فالدوال تمرّر القيمة كما هي (لا تغيير سلوك).
 * - decryptField يمرّر أي قيمة نصية قديمة غير مشفّرة كما هي (legacy plaintext).
 * - encryptField لا يعيد تشفير قيمة مشفّرة مسبقًا (idempotent).
 *
 * يُلَفّ لاحقًا حول قراءة/كتابة الحقول الحساسة في الخدمات (payout IBAN،
 * أرقام وثائق KYC) دون أي حزم خارجية — يعتمد فقط على node:crypto.
 */
const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function resolveKey(): Buffer | null {
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  // اشتقاق مفتاح 32 بايت ثابت من السرّ عبر SHA-256 (يقبل أي طول للسرّ).
  return createHash("sha256").update(raw).digest();
}

export function isFieldEncryptionEnabled(): boolean {
  return resolveKey() !== null;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  if (plain === "") return "";
  if (isEncrypted(plain)) return plain;
  const key = resolveKey();
  if (!key) return plain;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptField(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (!isEncrypted(stored)) return stored;
  const key = resolveKey();
  if (!key) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
