import { ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * حارس المصادقة الرئيسي. مُسجل **عالميًا** في `app.module.ts` عبر `APP_GUARD`،
 * فيكون الوضع الافتراضي لكل مسار: **محمي**.
 *
 * يُتجاوز الحراسة في حالتين فقط:
 * 1) وجود `@Public()` على الدالة أو المتحكم.
 * 2) السياق ليس HTTP (WebSocket أو RPC)، لأن مصادقة Socket.IO تتم في
 *    handshake داخل `realtime.gateway.ts` وليس عبر Passport.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (context.getType<string>() !== "http") return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    return super.canActivate(context);
  }
}
