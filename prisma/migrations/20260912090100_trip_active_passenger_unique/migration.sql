-- ============================================================================
-- قاعدة البيانات هي السلطة النهائية على قاعدة «رحلة فورية واحدة لكل راكب».
--
-- الفحوص في طبقة التطبيق (matching.requestRide و fare-offers.acceptOffer)
-- تقرأ ثم تكتب، وبين القراءة والكتابة يمكن لطلبين متوازيين أن يمرّا معًا
-- فتُنشأ رحلتان فوريتان للراكب نفسه. الفهرس الجزئي أدناه يجعل ذلك مستحيلًا
-- في القاعدة نفسها مهما فعلت طبقة التطبيق.
--
-- SCHEDULED مستثناة **عمدًا**: حجز مستقبلي ليس رحلة جارية، ولا يجوز أن
-- يحجب طلب رحلة فورية الآن. COMPLETED/CANCELLED مستثناتان طبعًا.
--
-- Prisma لا يستطيع التعبير عن فهرس تفرّد جزئي في schema.prisma، لذلك يبقى
-- هذا الفهرس مُعرَّفًا هنا فقط (كما في مايغريشن تقسيم TripTracking)، مع
-- تعليق مقابل في المخطط يمنع حذفه عن غير قصد.
-- ============================================================================

-- 1) Preflight: نرفض المايغريشن إن كانت البيانات الحالية تخالف القاعدة.
--    لا نحذف ولا نعدّل أي صف إطلاقًا — الفشل هنا مقصود، ويجب أن يُحلّ
--    تشغيليًا (إلغاء/إكمال الرحلات المكرّرة من اللوحة) قبل إعادة النشر.
--    التقرير يتضمّن الراكب وعدد رحلاته الجارية ليمكن معالجتها فورًا.
DO $$
DECLARE
    offenders TEXT;
BEGIN
    SELECT string_agg(format('passengerId=%s (%s active trips)', t."passengerId", t.cnt), ', ')
      INTO offenders
      FROM (
            SELECT "passengerId", COUNT(*) AS cnt
              FROM "Trip"
             WHERE "status" IN ('SEARCHING', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS')
             GROUP BY "passengerId"
            HAVING COUNT(*) > 1
             LIMIT 50
           ) AS t;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
          'Cannot create Trip_active_passenger_unique: passengers already hold more than one active (non-scheduled) trip: %. Resolve these trips operationally (cancel or complete) and re-run. This migration never mutates trip data.',
          offenders;
    END IF;
END
$$;

-- 2) الفهرس الجزئي الفريد.
CREATE UNIQUE INDEX "Trip_active_passenger_unique"
    ON "Trip" ("passengerId")
 WHERE "status" IN ('SEARCHING', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS');
