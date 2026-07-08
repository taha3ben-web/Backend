import { IsEnum, IsOptional, IsString } from "class-validator";

export enum FirebaseRole {
  PASSENGER = "PASSENGER",
  DRIVER = "DRIVER",
}

/**
 * تبادل رمز Firebase ID بجلسة JWT خاصة بالخادم.
 */
export class FirebaseLoginDto {
  @IsString()
  idToken!: string;

  // الدور المطلوب عند إنشاء المستخدم لأول مرة (افتراضي: PASSENGER).
  @IsOptional()
  @IsEnum(FirebaseRole)
  role?: FirebaseRole;

  // اسم/هاتف احتياطيّان إذا لم يحتوِ رمز Firebase عليهما.
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
