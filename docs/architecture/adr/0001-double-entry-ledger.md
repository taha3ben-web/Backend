# ADR-0001: دفتر أستاذ مزدوج القيد للمالية

- **الحالة:** مقبول (Accepted)
- **التاريخ:** 2026-07-17

## السياق

تتطلّب حركة الأموال (أجرة الرحلات، محافظ السائقين، السحوبات، التحويلات) دقّة
محاسبية قابلة للتدقيق، ولا تسمح بفقدان المال أو ازدواجية الخصم.

## القرار

اعتماد دفتر أستاذ مزدوج القيد (Double-Entry Ledger): كل معاملة (`LedgerTransaction`)
تتكوّن من قيود (`LedgerEntry`) مدينة/دائنة متوازنة على حسابات (`FinancialAccount`).

- توافقيّة (Idempotency) عبر `LedgerTransaction.idempotencyKey @unique`.
- قيد فريد `@@unique([transactionId, accountId, direction])` يمنع ازدواج القيد.
- فحص مطابقة دوري (`LedgerReconciliationIncident`) يرصد أي انحراف.
- كل المبالغ أعداد صحيحة بمقياس `MONEY_SCALE = 100`.

## البدائل المرفوضة

- حقل رصيد مفرد (single balance column): سهل لكنّه غير قابل للتدقيق وعرضة لسباق الكتابة.

## التبعات

- كل حركة مالية تجري داخل معاملة (Transaction) وتمرّ عبر طبقة الدفتر.
- الرصيد يُشتقّ جمعًا من القيود، ولا يُكتب مباشرة.

## المراجع

`prisma/schema.prisma` (نماذج `FinancialAccount`، `LedgerTransaction`، `LedgerEntry`، `LedgerReconciliationIncident`)؛ وحدة `src/modules/financial/`.
