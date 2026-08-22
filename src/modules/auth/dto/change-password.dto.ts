import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * تغيير كلمة المرور من داخل الحساب (المستخدم مُصادَق عليه أصلاً).
 *
 * لا يُنشئ نظام مصادقة جديداً: يستخدم نفس تخزين bcryptjs المعتمد في
 * AuthService.register/login (الحقل User.passwordHash).
 *
 * الحد الأدنى 6 لمطابقة RegisterDto، والحد الأقصى 72 لأنّ bcrypt يقطع ما
 * زاد عن 72 بايت.
 */
export class ChangePasswordDto {
  /**
   * المرحلة ج: أصبحت اختيارية على مستوى النقل فقط.
   *
   * سائق دخل بـ Firebase لا يملك كلمة مرور بعد، فـ @IsString() الإلزامي
   * كان يجعل خطوة "أكمل معلوماتك" تفشل دائمًا (400 من التحقق، أو
   * INVALID_CREDENTIALS لو أُرسلت قيمة وهمية) — أي أن التسجيل لم يكن
   * يكتمل أبدًا من التطبيق.
   *
   * الإلزام لم يُلغَِ، بل انتقل إلى الخادم حيث تُعرف الحقيقة: من لديه
   * كلمة مرور حقيقية يُرفض بدونها. انظر AuthService.changePassword.
   */
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  newPassword!: string;

  /** افتراضياً true: تُنهي الجلسات الأخرى بعد تغيير كلمة المرور. */
  @IsOptional()
  @IsBoolean()
  revokeOtherSessions?: boolean;
}
