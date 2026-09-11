-- ============================================================================
-- تحقّق من محاسبة تسوية الرحلة **على قاعدة بيانات حقيقية**.
--
-- لماذا هذا السكربت موجود بجانب `trip-settlement-model.spec.ts`:
-- الاختبار في الذاكرة يُثبت **المنطق** (ترتيب مصادر العمولة، عدم الائتمان
-- المزدوج، استهلاك رصيد الكوبون في الرحلة اللاحقة). هذا السكربت يُثبت أن
-- **قاعدة البيانات نفسها** تفرض ما يفترضه الكود:
--
--   1. مفتاح الخمول `LedgerTransaction.idempotencyKey` فريد فعلًا، فإعادة
--      التسوية مستحيلة على مستوى القاعدة لا بالاتفاق فقط.
--   2. القيد `LedgerEntry(transactionId, accountId, direction)` فريد.
--   3. مجموع كل الأرصدة = 0 بعد تسوية نقدية وتسوية بـflaminGO Pay ورصيد كوبون.
--   4. الرحلة النقدية لا تُنتج أي قيد على `PLATFORM:DRIVER_PAYABLE`
--      ولا أي دائن على حساب السائق — أي لا ائتمان اقتصادي مزدوج.
--   5. أعمدة Decimal(18,2) تحفظ المبالغ بلا انزلاق عشري.
--
-- السكربت يُرحّل نفس أشكال القيود التي تُنتجها `FinancialService.settleTrip`
-- بيدٍ، لأن تشغيل الكود يحتاج محرّك Prisma الأصلي. فهو **دليل على المخطط
-- والقيود**، لا بديل عن الاختبارات المعتمدة على قاعدة بيانات في CI.
--
-- التشغيل (قاعدة تطوير/تجريب فقط — ينتهي بـROLLBACK فلا يبقى أي صف):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-settlement-accounting.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- التهيئة ---
INSERT INTO "User" (id, name, phone, "passwordHash", type, status, "updatedAt")
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'Verify Driver',    '+213000010001', 'x', 'DRIVER',    'ACTIVE', now()),
  ('p0000000-0000-0000-0000-000000000001', 'Verify Passenger', '+213000010002', 'x', 'PASSENGER', 'ACTIVE', now());

INSERT INTO "FinancialParty" (id, type, "userId", "displayName", "countryCode", "createdAt", "updatedAt")
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'USER', 'd0000000-0000-0000-0000-000000000001', 'Verify Driver',    'DZ', now(), now()),
  ('f0000000-0000-0000-0000-000000000002', 'USER', 'p0000000-0000-0000-0000-000000000001', 'Verify Passenger', 'DZ', now(), now()),
  ('00000000-0000-0000-0000-000000000001', 'PLATFORM', NULL, 'flaminGO', 'DZ', now(), now());

-- الحسابات الخمسة التي يستعملها النموذج المصحّح، بنفس الرموز والأنواع.
INSERT INTO "FinancialAccount" (id, "partyId", code, type, currency, "balanceCache", "isActive", "createdAt", "updatedAt")
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE',         'LIABILITY', 'DZD', 0, true, now(), now()),
  ('a1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'USER:d0000000-0000-0000-0000-000000000001:DZD:COMMISSION_CREDIT', 'LIABILITY', 'DZD', 0, true, now(), now()),
  ('a1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000002', 'USER:p0000000-0000-0000-0000-000000000001:DZD:AVAILABLE',         'LIABILITY', 'DZD', 0, true, now(), now()),
  ('a1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'PLATFORM:COMMISSION:DZD',      'REVENUE',   'DZD', 0, true, now(), now()),
  ('a1000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'PLATFORM:DRIVER_PAYABLE:DZD',  'LIABILITY', 'DZD', 0, true, now(), now()),
  ('a1000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'PLATFORM:COUPON_SUBSIDY:DZD',  'EXPENSE',   'DZD', 0, true, now(), now()),
  ('a1000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'PLATFORM:TOPUP_CLEARING:DZD',  'ASSET',     'DZD', 0, true, now(), now());

-- ترحيل قيد متوازن بنفس منطق `LedgerCoreService.post`: تحديث الرصيد ثم
-- كتابة السطر مع `balanceAfter`. يرفع استثناءً إن لم يتوازن القيد.
CREATE OR REPLACE FUNCTION verify_post(
    p_key TEXT,
    p_command TEXT,
    p_lines JSONB  -- [{"account":"<code>","direction":"DEBIT|CREDIT","amount":150}]
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    tx_id   TEXT := gen_random_uuid()::text;
    line    JSONB;
    acc_id  TEXT;
    amt     NUMERIC(18,2);
    debit   NUMERIC(18,2) := 0;
    credit  NUMERIC(18,2) := 0;
    new_bal NUMERIC(18,2);
BEGIN
    FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        amt := (line->>'amount')::numeric;
        IF amt <= 0 THEN
            RAISE EXCEPTION 'ledger amount must be positive (got %)', amt;
        END IF;
        IF line->>'direction' = 'DEBIT' THEN debit := debit + amt;
                                        ELSE credit := credit + amt; END IF;
    END LOOP;
    IF debit <> credit OR debit <= 0 THEN
        RAISE EXCEPTION 'Unbalanced ledger transaction (debit=% credit=%)', debit, credit;
    END IF;

    INSERT INTO "LedgerTransaction"
        (id, command, "idempotencyKey", status, currency, "referenceType", "createdBy", "createdAt", "postedAt")
    VALUES (tx_id, p_command, p_key, 'POSTED', 'DZD', 'TRIP', 'VERIFY', now(), now());

    FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        amt := (line->>'amount')::numeric;
        SELECT id INTO acc_id FROM "FinancialAccount" WHERE code = line->>'account';
        IF acc_id IS NULL THEN
            RAISE EXCEPTION 'unknown account %', line->>'account';
        END IF;
        UPDATE "FinancialAccount"
           SET "balanceCache" = "balanceCache"
               + CASE WHEN line->>'direction' = 'CREDIT' THEN amt ELSE -amt END
         WHERE id = acc_id
        RETURNING "balanceCache" INTO new_bal;

        INSERT INTO "LedgerEntry"
            (id, "transactionId", "accountId", direction, amount, currency, "balanceAfter", "createdAt")
        VALUES (gen_random_uuid()::text, tx_id, acc_id,
                (line->>'direction')::"LedgerEntryDirection", amt, 'DZD', new_bal, now());
    END LOOP;

    RETURN tx_id;
END
$$;

CREATE OR REPLACE FUNCTION verify_balance(p_code TEXT) RETURNS NUMERIC LANGUAGE sql AS $$
    SELECT "balanceCache" FROM "FinancialAccount" WHERE code = p_code;
$$;

CREATE OR REPLACE FUNCTION verify_assert(p_label TEXT, p_actual NUMERIC, p_expected NUMERIC)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF p_actual IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
    END IF;
    RAISE NOTICE 'OK  % = %', p_label, p_actual;
END
$$;

-- ------------------------------------------------ 0) شحن محفظة العمولة ---
DO $$
BEGIN
    PERFORM verify_post('wallet:topup:verify-1', 'creditWalletTopUp', '[
      {"account":"PLATFORM:TOPUP_CLEARING:DZD","direction":"DEBIT","amount":500},
      {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"CREDIT","amount":500}
    ]'::jsonb);
    PERFORM verify_assert('driver commission wallet after top-up',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 500);
END
$$;

-- الشحن المكرّر: القاعدة نفسها ترفضه عبر تفرّد idempotencyKey.
DO $$
BEGIN
    BEGIN
        PERFORM verify_post('wallet:topup:verify-1', 'creditWalletTopUp', '[
          {"account":"PLATFORM:TOPUP_CLEARING:DZD","direction":"DEBIT","amount":500},
          {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"CREDIT","amount":500}
        ]'::jsonb);
        RAISE EXCEPTION 'FAIL a duplicate top-up was accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK  duplicate top-up rejected by the database (SQLSTATE 23505)';
    END;
    PERFORM verify_assert('driver commission wallet unchanged after duplicate',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 500);
END
$$;

-- --------------------------------- 1) رحلة نقدية: 1000 دج، عمولة 15% ---
-- القيد الوحيد: العمولة من محفظة العمولة. **لا قيد تحصيل أجرة إطلاقًا.**
DO $$
BEGIN
    PERFORM verify_post('trip:commission:verify-cash', 'settleTripCommission', '[
      {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"DEBIT","amount":150},
      {"account":"PLATFORM:COMMISSION:DZD","direction":"CREDIT","amount":150}
    ]'::jsonb);

    PERFORM verify_assert('cash ride | driver commission wallet',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 350);
    PERFORM verify_assert('cash ride | platform commission',
        verify_balance('PLATFORM:COMMISSION:DZD'), 150);
    -- الحرج: لا مستحقّ للسائق ولا رصيد إضافي — لا ائتمان اقتصادي مزدوج.
    PERFORM verify_assert('cash ride | driver payable stays zero',
        verify_balance('PLATFORM:DRIVER_PAYABLE:DZD'), 0);
END
$$;

-- إعادة تسوية نفس الرحلة: مرفوضة على مستوى القاعدة.
DO $$
BEGIN
    BEGIN
        PERFORM verify_post('trip:commission:verify-cash', 'settleTripCommission', '[
          {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"DEBIT","amount":150},
          {"account":"PLATFORM:COMMISSION:DZD","direction":"CREDIT","amount":150}
        ]'::jsonb);
        RAISE EXCEPTION 'FAIL commission was debited twice';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK  repeated settlement rejected by the database (SQLSTATE 23505)';
    END;
    PERFORM verify_assert('cash ride | wallet after repeated settlement',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 350);
END
$$;

-- ------------------- 2) رحلة flaminGO Pay: 1000 دج، عمولة 15% ---
DO $$
BEGIN
    -- الراكب يشحن رصيده أولًا.
    PERFORM verify_post('wallet:topup:verify-2', 'creditWalletTopUp', '[
      {"account":"PLATFORM:TOPUP_CLEARING:DZD","direction":"DEBIT","amount":2000},
      {"account":"USER:p0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"CREDIT","amount":2000}
    ]'::jsonb);

    -- القيد 1: تحصيل الأجرة إلى مستحقّ السائق.
    PERFORM verify_post('trip:settle:verify-pay', 'settleTrip', '[
      {"account":"USER:p0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"DEBIT","amount":1000},
      {"account":"PLATFORM:DRIVER_PAYABLE:DZD","direction":"CREDIT","amount":1000}
    ]'::jsonb);
    -- القيد 2: العمولة محتجزة من المُحصَّل، لا من محفظة السائق.
    PERFORM verify_post('trip:commission:verify-pay', 'settleTripCommission', '[
      {"account":"PLATFORM:DRIVER_PAYABLE:DZD","direction":"DEBIT","amount":150},
      {"account":"PLATFORM:COMMISSION:DZD","direction":"CREDIT","amount":150}
    ]'::jsonb);

    PERFORM verify_assert('pay ride | passenger flaminGO Pay',
        verify_balance('USER:p0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 1000);
    PERFORM verify_assert('pay ride | driver payable (net earnings owed)',
        verify_balance('PLATFORM:DRIVER_PAYABLE:DZD'), 850);
    PERFORM verify_assert('pay ride | platform commission cumulative',
        verify_balance('PLATFORM:COMMISSION:DZD'), 300);
    -- محفظة العمولة لم تُمسّ في المسار الإلكتروني.
    PERFORM verify_assert('pay ride | driver commission wallet untouched',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 350);
END
$$;

-- -------- 3) كوبون 200 دج تموّله المنصّة ⇒ رصيد عمولة لا نقدًا ---
DO $$
BEGIN
    PERFORM verify_post('trip:couponcredit:verify-coupon', 'grantCouponCommissionCredit', '[
      {"account":"PLATFORM:COUPON_SUBSIDY:DZD","direction":"DEBIT","amount":200},
      {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:COMMISSION_CREDIT","direction":"CREDIT","amount":200}
    ]'::jsonb);

    PERFORM verify_assert('coupon | driver commission credit',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:COMMISSION_CREDIT'), 200);
    -- المنفعة **لم** تدخل محفظة الدفع ولا مستحقّ السائق.
    PERFORM verify_assert('coupon | commission wallet unaffected',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 350);

    -- الرحلة التالية: العمولة تُستهلك من رصيد الكوبون أولًا.
    PERFORM verify_post('trip:commission:verify-next', 'settleTripCommission', '[
      {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:COMMISSION_CREDIT","direction":"DEBIT","amount":150},
      {"account":"PLATFORM:COMMISSION:DZD","direction":"CREDIT","amount":150}
    ]'::jsonb);
    PERFORM verify_assert('coupon | credit remaining after next commission',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:COMMISSION_CREDIT'), 50);
    PERFORM verify_assert('coupon | wallet still untouched by that commission',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 350);
END
$$;

-- ------------------------------------------ 4) ثوابت عامة على الدفتر ---
DO $$
DECLARE
    total        NUMERIC(18,2);
    derived_gap  NUMERIC(18,2);
    driver_credits NUMERIC(18,2);
BEGIN
    -- حفظ القيمة: مجموع كل الأرصدة صفر (قيد مزدوج سليم).
    SELECT COALESCE(SUM("balanceCache"), 0) INTO total FROM "FinancialAccount";
    PERFORM verify_assert('ledger | sum of all balances', total, 0);

    -- كل رصيد مخزَّن يطابق ما تُنتجه قيوده (Σ CREDIT − Σ DEBIT).
    SELECT COALESCE(SUM(diff), 0) INTO derived_gap FROM (
        SELECT a."balanceCache" - COALESCE(SUM(
                   CASE WHEN e.direction = 'CREDIT' THEN e.amount ELSE -e.amount END
               ), 0) AS diff
          FROM "FinancialAccount" a
          LEFT JOIN "LedgerEntry" e ON e."accountId" = a.id
         GROUP BY a.id, a."balanceCache"
    ) t;
    PERFORM verify_assert('ledger | cached vs derived balance drift', derived_gap, 0);

    -- لا قيد دائن واحد على أي حساب سائق في مسار الرحلة النقدية.
    SELECT COALESCE(SUM(e.amount), 0) INTO driver_credits
      FROM "LedgerEntry" e
      JOIN "FinancialAccount" a ON a.id = e."accountId"
      JOIN "LedgerTransaction" t ON t.id = e."transactionId"
     WHERE e.direction = 'CREDIT'
       AND a.code = 'USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'
       AND t."idempotencyKey" LIKE 'trip:%';
    PERFORM verify_assert('cash ride | credits to driver wallet from any trip', driver_credits, 0);
END
$$;

-- قيد التفرّد على سطور القيد نفسه.
DO $$
DECLARE tx TEXT;
BEGIN
    SELECT id INTO tx FROM "LedgerTransaction"
     WHERE "idempotencyKey" = 'trip:commission:verify-cash';
    BEGIN
        INSERT INTO "LedgerEntry"
            (id, "transactionId", "accountId", direction, amount, currency, "createdAt")
        VALUES (gen_random_uuid()::text, tx,
                'a1000000-0000-0000-0000-000000000004', 'CREDIT', 150, 'DZD', now());
        RAISE EXCEPTION 'FAIL a duplicate ledger entry was accepted';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'OK  duplicate ledger entry rejected (transactionId, accountId, direction)';
    END;
END
$$;

-- دقّة Decimal(18,2): مبالغ بكسور لا تنزلق.
DO $$
BEGIN
    PERFORM verify_post('trip:commission:verify-precision', 'settleTripCommission', '[
      {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"DEBIT","amount":58.33},
      {"account":"PLATFORM:COMMISSION:DZD","direction":"CREDIT","amount":58.33}
    ]'::jsonb);
    PERFORM verify_assert('precision | wallet after 58.33 debit',
        verify_balance('USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE'), 291.67);
END
$$;

-- قيد غير متوازن مرفوض (نفس عقد `LedgerCoreService.assertBalanced`).
DO $$
BEGIN
    BEGIN
        PERFORM verify_post('trip:commission:verify-unbalanced', 'settleTripCommission', '[
          {"account":"USER:d0000000-0000-0000-0000-000000000001:DZD:AVAILABLE","direction":"DEBIT","amount":100},
          {"account":"PLATFORM:COMMISSION:DZD","direction":"CREDIT","amount":90}
        ]'::jsonb);
        RAISE EXCEPTION 'FAIL an unbalanced transaction was accepted';
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
        RAISE NOTICE 'OK  unbalanced transaction rejected (%)', SQLERRM;
    END;
END
$$;

DROP FUNCTION verify_post(TEXT, TEXT, JSONB);
DROP FUNCTION verify_balance(TEXT);
DROP FUNCTION verify_assert(TEXT, NUMERIC, NUMERIC);

ROLLBACK;
