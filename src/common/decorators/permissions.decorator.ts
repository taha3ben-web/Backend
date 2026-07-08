import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";

/**
 * يقيّد الوصول حسب مفاتيح الصلاحيات (مثل "drivers.manage").
 * يُستخدم مع PermissionsGuard. صاحب الصلاحية "*" يمرّ دائمًا.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
