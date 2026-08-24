-- Fraud & Risk (محرّك المخاطر + قائمة حظر + طابور مراجعة + حجز يدوي)

-- CreateEnum
CREATE TYPE "RiskDecisionKind" AS ENUM ('ALLOW', 'REVIEW', 'BLOCK');
CREATE TYPE "RiskLevelKind" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "BlacklistKind" AS ENUM ('USER', 'DEVICE', 'IP', 'PHONE', 'CARD');
CREATE TYPE "RiskReviewStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevelKind" NOT NULL,
    "decision" "RiskDecisionKind" NOT NULL,
    "amount" DOUBLE PRECISION,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlacklistEntry" (
    "id" TEXT NOT NULL,
    "kind" "BlacklistKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlacklistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskReview" (
    "id" TEXT NOT NULL,
    "riskEventId" TEXT,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "RiskReviewStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskHold" (
    "id" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskEvent_subjectKind_subjectId_idx" ON "RiskEvent"("subjectKind", "subjectId");
CREATE INDEX "RiskEvent_decision_createdAt_idx" ON "RiskEvent"("decision", "createdAt");
CREATE UNIQUE INDEX "BlacklistEntry_kind_value_key" ON "BlacklistEntry"("kind", "value");
CREATE INDEX "BlacklistEntry_kind_active_idx" ON "BlacklistEntry"("kind", "active");
CREATE INDEX "RiskReview_status_score_idx" ON "RiskReview"("status", "score");
CREATE INDEX "RiskHold_subjectKind_subjectId_active_idx" ON "RiskHold"("subjectKind", "subjectId", "active");
