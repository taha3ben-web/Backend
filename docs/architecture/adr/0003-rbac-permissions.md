# ADR-0003: التحكّم بالوصول عبر RBAC (أدوار + صلاحيات)

- **الحالة:** مقبول (Accepted)
- **التاريخ:** 2026-07-17

## السياق

تتطلّب لوحة التحكّم تحكّمًا دقيقًا بالوصول لفرق متعدّدة (دعم، مالية، مخاطر، إلخ)
دون منح صلاحيات زائدة.

## القرار

تحكّم قائم على الأدوار (RBAC) مع صلاحيات دقيقة (`Permission.key`):

- طبقات حراسة متتالية: `JwtAuthGuard` → `RolesGuard` → `PermissionsGuard`.
- كل مسار يعلن حاجته صراحة عبر `@RequirePermissions("resource.action")`.
- ربط الأدوار بالصلاحيات عبر `RolePermission`.
- لوحة التحكّم تعكس نفس القواعد عبر `ROUTE_RULES` + `useAuth().can(...)`.

## البدائل المرفوضة

- تحكّم بالأدوار فقط (بلا صلاحيات): خشن ويصعّب مبدأ الأقلّ امتيازًا.

## التبعات

- إضافة مسار محمي تستلزم إعلان صلاحية وربطها بالدور المناسب وإضافتها في لوحة التحكّم.
- تُوثّق الصلاحيات المطلوبة لكل مسار في `docs/api/endpoints.md` (مُولّد).

## المراجع

`src/common/guards/{jwt-auth,roles,permissions}.guard.ts`، `src/common/decorators/{roles,permissions}.decorator.ts`؛ نماذج `Role`/`Permission`/`RolePermission`؛ وحدة `src/modules/rbac/`.
