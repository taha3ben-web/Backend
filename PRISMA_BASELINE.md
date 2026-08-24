# Prisma Baseline

هذا الملف يوثّق إغلاق مشكلة Prisma Baseline: ما كانت المشكلة، وما تغيّر،
وما أُثبت فعليًا داخل CI، وما يبقى للإنتاج ويحتاج موافقة منفصلة.

## 1. المشكلة

أمر البناء على Render يستخدم `prisma db push --accept-data-loss`، وهو يدفع المخطط
مباشرة إلى قاعدة البيانات دون أن يكتب أي تاريخ هجرات. لذلك:

- قاعدة الإنتاج (Neon) لا تملك جدول `_prisma_migrations` إطلاقًا (`SQLSTATE 42P01`).
- الـ68 migration في `prisma/migrations/` لم يُسجَّل أيٌّ منها كمُطبَّق.
- لو شُغّل `prisma migrate deploy` على الإنتاج، لحاول تنفيذ الـ68 من الصفر على
  قاعدة مأهولة ببيانات حقيقية، فيفشل عند أول `CREATE TABLE`.

وفي الوقت نفسه، إعادة تشغيل الـ68 على قاعدة فارغة لا تعطي المخطط الحالي: تاريخ
الهجرات انحرف عن `schema.prisma`. وهجرتان تحملان الطابع الزمني نفسه
(`20260711190000`).

## 2. محاولة سابقة فاشلة (الفرع chore/prisma-baseline، PR #15)

أُنشئ `prisma/migrations/0_init/migration.sql` بحجم **0 بايت**، لسببين مجتمعين:

1. `... --script > prisma/migrations/0_init/migration.sql` — إعادة التوجيه تقتطع الملف
   الهدف قبل أن يكتب Prisma فيه. القاعدة: دائمًا `-o /tmp/...`.
2. `schema-engine-linux-arm64-openssl-3.0.x` مربوط بـglibc ولا يعمل على bionic libc
   الخاص بـTermux (`Error: Error in Schema engine`). لا يوجد هدف Android.

ملف بـ0 بايت لا يجوز أبدًا أن يُسجَّل بـ`migrate resolve --applied`، لأن ذلك يجمّد
الأساس على "لا شيء" ويجعل كل ما يليه مبنيًا على فراغ. لهذا لم يُدمج PR #15.

## 3. ما تغيّر فعليًا

| ما | لمادا |
| --- | --- |
| `prisma/migrations/0_init/migration.sql` جديد | أساس مولّد من `schema.prisma` مباشرة، ومُثبَت أنه يعيد إنتاجه حرفيًا |
| الـ68 القديمة → `prisma/migrations_archive/` | لمنع `migrate deploy` من محاولة إعادة تنفيذها، دون حذف التاريخ. `git mv` فقط: لا حذف ولا تعديل محتوى |
| `prisma/migrations/migration_lock.toml` | بقي كما هو (`provider = "postgresql"`) |
| `.github/workflows/prisma-baseline.yml` | التوليد والإثبات داخل Linux x64، ومنع الانحراف مستقبلاً |
| `.github/scripts/verify-baseline-sql.js` | يرفض أي أساس يحتوي عبارة بيانات أو عبارة مدمرة |

لم يُلمس: `prisma/schema.prisma`، `prisma/seed.ts`، `src/`، `test/`، `package.json`،
`package-lock.json`، أو أي منطق تطبيق أو عقد API.

## 4. ما أُثبت داخل GitHub Actions

على حاوية Postgres 16 مؤقتة داخل الـrunner، لا على Neon:

1. `prisma:validate` يمر.
2. `migrate diff --from-empty --to-schema-datamodel` يولّد الأساس، ويُرفض إن احتوى
   `DROP` أو `DELETE` أو `UPDATE` أو `INSERT` أو `TRUNCATE` أو `ALTER COLUMN` أو
   `CREATE FUNCTION` أو `PARTITION`، أو إن غاب `Driver_wilayaId`.
3. `migrate deploy` يطبّق `0_init` بنجاح.
4. `migrate status` يقول إن القاعدة محدّثة.
5. `migrate diff --from-url <المؤقتة> --to-schema-datamodel prisma/schema.prisma`
   يُرجع سكربتًا **فارغًا**. هذا الإثبات الحقيقي: الأساس يعيد إنتاج المخطط بلا فرق.
6. `migrate deploy` مرة ثانية = لا شيء (idempotent).
7. `build` + `test:ci` + `lint:check` + `typecheck:strict` تمر جميعًا.

في كل pull request يمس `prisma/**`، يُعاد توليد الأساس ويُقارن بالملف المُلتزم به
بايتًا ببايت، فلا يمكن أن ينحرفا بصمت.

## 5. قاعدة دائمة بعد اليوم

- `prisma/migrations/0_init/` **لا يُعدّل أبدًا**. أي تغيير في المخطط = migration جديدة
  بطابع زمني تالٍ.
- `prisma/migrations_archive/` تاريخ للقراءة فقط، وPrisma لا تقرأه.

## 6. ما يبقى للإنتاج — يحتاج موافقة منفصلة ولم يُنفّذ هنا

لا يوجد workflow يتصل بـNeon، ولا يجوز تنفيذ ما يلي دون أمر صريح:

1. أخذ نسخة احتياطية / فرع Neon من الإنتاج.
2. على الفرع أولًا وللقراءة فقط:
   `npx prisma migrate diff --from-url "$BRANCH_URL" --to-schema-datamodel prisma/schema.prisma --script`
   — **يجب أن يكون فارغًا**. إن لم يكن، يُوقف كل شيء ويُدرس الفرق أولًا.
3. `npx prisma migrate resolve --applied 0_init` على الفرع، ثم `migrate status`.
   هذا يكتب سطرًا واحدًا في `_prisma_migrations` ولا يلمس أي جدول بيانات.
4. تكرار 3 على الإنتاج بعد نجاحه على الفرع.
5. تبديل أمر بناء Render من `prisma db push --accept-data-loss` إلى `prisma migrate deploy`.

ممنوع في كل الأحوال: `migrate reset`، `--accept-data-loss`، أي `DROP`/`DELETE`/`TRUNCATE`
على الإنتاج، أو `migrate resolve` لملف لم تُراجعه.

## 7. مسائل معروفة خارج نطاق هذا الفرع

مُسجّلة للشفافية فقط، ولم يُلمس أي منها هنا:

- **ISSUE-1**: الدالة `flamingo_ensure_tracking_partition(date)` غائبة من الإنتاج، بينما
  `tracking-retention.service.ts` يناديها. تفشل الأن في الإنتاج. لا يمكن لـ`0_init`
  أن يُنشئها لأن `schema.prisma` لا يعرف الدوال.
- **ISSUE-2**: 3 سائقين بـ`wilayaId = NULL`. يحتاج backfill منفصل idempotent، لا `UPDATE` الأن.
- **ISSUE-3**: اعتماد الأساس يُسقط من مسار الإعادة عبارات البيانات الـ26 الموجودة في
  الهجرات المؤرشفة (`Trip.settlementStatus`، `User.username` للـstaff، `CouponRedemption`
  من الرحلات، هجرة المحفظة القديمة). هذا لا يمس بيانات الإنتاج الحالية، لأنها
  نُفّذت فعلًا وقتها؛ ولكنه يعني أن قاعدة جديدة من `0_init` تأتي فارغة من تلك البيانات
  (مهمة `prisma/seed.ts`).
