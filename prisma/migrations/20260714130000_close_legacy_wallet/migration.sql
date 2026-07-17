-- Round 24: close legacy Wallet as a financial source of truth.
-- Archive all legacy data, import only balances without Ledger history,
-- then remove the obsolete operational tables and enum.

CREATE TABLE "LegacyWalletArchive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "transactions" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegacyWalletArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegacyWalletArchive_userId_key" ON "LegacyWalletArchive"("userId");

INSERT INTO "LegacyWalletArchive" ("id", "userId", "balance", "currency", "transactions", "archivedAt")
SELECT
    w."id", w."userId", w."balance", w."currency",
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', wt."id", 'type', wt."type"::text,
                'amount', wt."amount", 'balanceAfter', wt."balanceAfter",
                'reason', wt."reason", 'createdAt', wt."createdAt"
            ) ORDER BY wt."createdAt", wt."id"
        ) FILTER (WHERE wt."id" IS NOT NULL),
        '[]'::jsonb
    ),
    CURRENT_TIMESTAMP
FROM "Wallet" w
LEFT JOIN "WalletTransaction" wt ON wt."walletId" = w."id"
GROUP BY w."id", w."userId", w."balance", w."currency";

-- Ensure every legacy owner has a Ledger party and available-balance account.
INSERT INTO "FinancialParty" ("type", "userId", "displayName", "countryCode", "createdAt", "updatedAt")
SELECT 'USER'::"FinancialPartyType", w."userId", u."name", 'DZ', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Wallet" w
JOIN "User" u ON u."id" = w."userId"
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "FinancialAccount" (
    "partyId", "code", "type", "currency", "balanceCache", "isActive", "createdAt", "updatedAt"
)
SELECT
    fp."id",
    'USER:' || w."userId" || ':' ||
      CASE WHEN w."currency" ~ '^[A-Za-z]{3}$' THEN UPPER(w."currency") ELSE 'DZD' END ||
      ':AVAILABLE',
    'LIABILITY'::"FinancialAccountType",
    CASE WHEN w."currency" ~ '^[A-Za-z]{3}$' THEN UPPER(w."currency") ELSE 'DZD' END,
    0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Wallet" w
JOIN "FinancialParty" fp ON fp."userId" = w."userId"
ON CONFLICT ("code") DO NOTHING;

-- Balancing equity account for opening balances imported from the retired source.
INSERT INTO "FinancialParty" ("id", "type", "displayName", "countryCode", "createdAt", "updatedAt")
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'PLATFORM'::"FinancialPartyType", 'NOVA Ride', 'DZ', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "FinancialAccount" (
    "partyId", "code", "type", "currency", "balanceCache", "isActive", "createdAt", "updatedAt"
)
SELECT DISTINCT
    '00000000-0000-0000-0000-000000000001',
    'PLATFORM:LEGACY_WALLET_MIGRATION:' || normalized."currency",
    'EQUITY'::"FinancialAccountType", normalized."currency",
    0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT
      w."userId", w."balance",
      CASE WHEN w."currency" ~ '^[A-Za-z]{3}$' THEN UPPER(w."currency") ELSE 'DZD' END AS "currency"
    FROM "Wallet" w
) normalized
JOIN "FinancialAccount" ua
  ON ua."code" = 'USER:' || normalized."userId" || ':' || normalized."currency" || ':AVAILABLE'
WHERE normalized."balance" <> 0
  AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" le WHERE le."accountId" = ua."id")
ON CONFLICT ("code") DO NOTHING;

-- Wallets with existing Ledger entries are archived but not imported to avoid double-credit.
CREATE TEMP TABLE "_LegacyWalletImport" ON COMMIT DROP AS
SELECT
    w."id" AS "walletId", w."userId",
    CASE WHEN w."currency" ~ '^[A-Za-z]{3}$' THEN UPPER(w."currency") ELSE 'DZD' END AS "currency",
    w."balance"::DECIMAL(18,2) AS "signedAmount",
    ua."id" AS "userAccountId", ea."id" AS "equityAccountId",
    'legacy-wallet-import:' || w."id" AS "transactionId"
FROM "Wallet" w
JOIN "FinancialAccount" ua
  ON ua."code" = 'USER:' || w."userId" || ':' ||
    CASE WHEN w."currency" ~ '^[A-Za-z]{3}$' THEN UPPER(w."currency") ELSE 'DZD' END ||
    ':AVAILABLE'
JOIN "FinancialAccount" ea
  ON ea."code" = 'PLATFORM:LEGACY_WALLET_MIGRATION:' ||
    CASE WHEN w."currency" ~ '^[A-Za-z]{3}$' THEN UPPER(w."currency") ELSE 'DZD' END
WHERE w."balance" <> 0
  AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" le WHERE le."accountId" = ua."id")
  AND NOT EXISTS (
    SELECT 1 FROM "LedgerTransaction" lt
    WHERE lt."idempotencyKey" = 'legacy-wallet-import:' || w."id"
  );

INSERT INTO "LedgerTransaction" (
    "id", "command", "idempotencyKey", "status", "currency",
    "referenceType", "referenceId", "metadata", "createdBy", "reason", "createdAt", "postedAt"
)
SELECT
    i."transactionId", 'importLegacyWalletBalance', i."transactionId",
    'POSTED'::"LedgerTransactionStatus", i."currency",
    'LEGACY_WALLET', i."walletId",
    jsonb_build_object('source', 'Wallet', 'migration', '20260714130000_close_legacy_wallet'),
    'SYSTEM', 'Opening balance imported while retiring legacy Wallet',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_LegacyWalletImport" i;

-- Equal amounts with opposite directions preserve the double-entry invariant.
INSERT INTO "LedgerEntry" (
    "id", "transactionId", "accountId", "direction", "amount",
    "currency", "role", "balanceAfter", "createdAt"
)
SELECT
    'legacy-wallet-user-entry:' || i."walletId", i."transactionId", i."userAccountId",
    CASE WHEN i."signedAmount" > 0 THEN 'CREDIT'::"LedgerEntryDirection" ELSE 'DEBIT'::"LedgerEntryDirection" END,
    ABS(i."signedAmount"), i."currency", 'LIABILITY',
    ua."balanceCache" + i."signedAmount", CURRENT_TIMESTAMP
FROM "_LegacyWalletImport" i
JOIN "FinancialAccount" ua ON ua."id" = i."userAccountId";

INSERT INTO "LedgerEntry" (
    "id", "transactionId", "accountId", "direction", "amount",
    "currency", "role", "balanceAfter", "createdAt"
)
SELECT
    'legacy-wallet-equity-entry:' || i."walletId", i."transactionId", i."equityAccountId",
    CASE WHEN i."signedAmount" > 0 THEN 'DEBIT'::"LedgerEntryDirection" ELSE 'CREDIT'::"LedgerEntryDirection" END,
    ABS(i."signedAmount"), i."currency", 'EQUITY',
    ea."balanceCache" - SUM(i."signedAmount") OVER (
      PARTITION BY i."currency" ORDER BY i."walletId"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ),
    CURRENT_TIMESTAMP
FROM "_LegacyWalletImport" i
JOIN "FinancialAccount" ea ON ea."id" = i."equityAccountId";

UPDATE "FinancialAccount" account
SET "balanceCache" = account."balanceCache" + imported."signedAmount", "updatedAt" = CURRENT_TIMESTAMP
FROM "_LegacyWalletImport" imported
WHERE account."id" = imported."userAccountId";

UPDATE "FinancialAccount" account
SET "balanceCache" = account."balanceCache" - totals."signedTotal", "updatedAt" = CURRENT_TIMESTAMP
FROM (
    SELECT "equityAccountId", SUM("signedAmount") AS "signedTotal"
    FROM "_LegacyWalletImport" GROUP BY "equityAccountId"
) totals
WHERE account."id" = totals."equityAccountId";

DROP TABLE "WalletTransaction";
DROP TABLE "Wallet";
DROP TYPE "WalletTxType";
