import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

/** يقيّد الوصول حسب نوع المستخدم (PASSENGER | DRIVER | STAFF) */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
