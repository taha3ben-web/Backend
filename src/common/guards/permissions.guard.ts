import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";

/**
 * حارس صلاحيات دقيق (RBAC): يحمّل صلاحيات دور الموظف من قاعدة البيانات.
 * - إن لم تُطلب أي صلاحية ← يسمح.
 * - صاحب الصلاحية "*" (مدير عام) يمرّ دائمًا.
 * - يكفي امتلاك إحدى الصلاحيات المطلوبة.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) throw new ForbiddenException("غير مصرّح");

    const permissions = await this.loadPermissions(user.userId);
    if (permissions.has("*")) return true;

    const allowed = required.some((p) => permissions.has(p));
    if (!allowed) {
      throw new ForbiddenException("لا تملك الصلاحية اللازمة");
    }
    return true;
  }

  private async loadPermissions(userId: string): Promise<Set<string>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        staffRole: {
          select: { permissions: { select: { permission: true } } },
        },
      },
    });
    const keys = (user?.staffRole?.permissions ?? []).map(
      (rp) => rp.permission.key,
    );
    return new Set(keys);
  }
}
