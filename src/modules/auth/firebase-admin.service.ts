import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as admin from "firebase-admin";

/**
 * جسر الهوية: يتحقّق من رموز Firebase ID القادمة من تطبيقي الراكب/السائق.
 *
 * - يُهيّأ Firebase Admin SDK مرة واحدة (lazy) من متغيرات البيئة.
 * - إذا لم تُضبط بيانات الاعتماد، يبقى الجسر معطّلًا (isEnabled=false)
 *   دون إسقاط الخادم — بقية المصادقة (JWT) تعمل طبيعيًا.
 */
@Injectable()
export class FirebaseAdminService {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app: admin.app.App | null = null;
  private initialized = false;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    this.ensureInit();
    return this.app !== null;
  }

  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;

    const projectId = this.config.get<string>("firebase.projectId");
    const clientEmail = this.config.get<string>("firebase.clientEmail");
    const privateKey = this.config.get<string>("firebase.privateKey");

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        "Firebase Admin غير مُفعّل (لا توجد بيانات اعتماد). جسر Firebase معطّل.",
      );
      return;
    }

    try {
      // إعادة استخدام التطبيق إن كان مُهيّأًا مسبقًا (hot reload).
      this.app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey,
            }),
          });
      this.logger.log("Firebase Admin جاهز — جسر الهوية مُفعّل.");
    } catch (err) {
      this.logger.error("فشل تهيئة Firebase Admin", err as Error);
      this.app = null;
    }
  }

  /**
   * يتحقّق من رمز Firebase ID ويُرجِع بيانات المستخدم المُتحقّق منها.
   */
  async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    this.ensureInit();
    if (!this.app) {
      throw new UnauthorizedException("جسر Firebase غير مُفعّل على الخادم");
    }
    try {
      return await this.app.auth().verifyIdToken(idToken, true);
    } catch {
      throw new UnauthorizedException("رمز Firebase غير صالح");
    }
  }
}
