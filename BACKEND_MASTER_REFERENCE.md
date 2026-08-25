# BACKEND_MASTER_REFERENCE.md

**Document:** BACKEND_MASTER_REFERENCE.md
**Project:** flaminGO Backend (package name: `nova-backend`)
**Repository:** taha3ben-web/Backend
**Document Type:** Living Backend Source of Truth
**Baseline Date:** 2026-08-25
**Last Verified:** 2026-08-25
**Baseline Commit:** `647dc78065e702c21d496909a655e72ed4910d43`
**Production Status:** PRODUCTION READY (per FINAL READ-ONLY AUDIT completed 2026-08-25)

> Update this document whenever the backend architecture, API, database, infrastructure, configuration, security model, integrations, or runtime behavior changes.
>
> **BACKEND_MASTER_REFERENCE.md is a living source-of-truth document.** See Section 38 ("Mandatory Document Update Rule") for the required workflow whenever the backend changes.

---

## Methodology note (read first)

This document was produced from a READ-ONLY audit of the actual repository content at commit `647dc78065e702c21d496909a655e72ed4910d43` (GitHub API: file contents, directory listings, workflow files), the actual `prisma/schema.prisma` file, and prior READ-ONLY verification of Neon Production and Render (documented in the FINAL READ-ONLY AUDIT delivered the same day, referenced throughout).

Given the size of this backend (60+ NestJS modules), this baseline captures, with real evidence:
- Full module inventory (all 60 module directories under `src/modules`, and their imports as wired in `app.module.ts`).
- Full database inventory derived directly from `prisma/schema.prisma` (models, enums, relations, indexes as declared in the schema file).
- Full environment variable **names** from `.env.example`.
- Full workflow list and content for `ci.yml` and `security.yml` (read in full); other workflows are listed by filename with details **NOT VERIFIED in this pass** (see Section 30).
- Full root-level file/directory inventory.

It does **not** yet contain a line-by-line extraction of every controller's HTTP routes, every Socket.IO event handler, or every DTO for all 60 modules — that requires opening every controller/gateway file individually. Where this document does not contain that level of detail, it says explicitly **NOT VERIFIED — requires per-controller extraction** rather than guessing. This is intentional per the audit rule: no information is asserted without direct evidence.

---

## 1. Project Identity

| Field | Value | Evidence |
|---|---|---|
| Project name | flaminGO Backend (internal package name `nova-backend`, internal codename "NOVA Ride") | `package.json` (`"name": "nova-backend"`), `src/main.ts` (`"NOVA backend running on port ..."`), Swagger title `"NOVA Ride API"` |
| Repository | `taha3ben-web/Backend` | GitHub |
| GitHub URL | `https://github.com/taha3ben-web/Backend` | GitHub |
| Main branch | `main` | GitHub |
| Current HEAD commit (at baseline) | `647dc78065e702c21d496909a655e72ed4910d43` ("Merge pull request #20 from taha3ben-web/ci/prisma-production-deploy-workflow") | `list_commits` |
| Latest migration | `20260825122500_trip_tracking_partitioning` | `prisma/migrations/` directory listing |
| Framework | NestJS v10 (`@nestjs/core` `^10.3.8`) | `package.json` |
| Language | TypeScript `^5.5.3` | `package.json` |
| Package manager | npm (`packageManager: "npm@10.8.2"`) | `package.json` |
| Node version required | `>=20.15 <21` | `package.json engines` |
| npm version required | `>=10 <11` | `package.json engines` |
| Prisma version | `^5.15.0` (`@prisma/client` and `prisma` devDependency) | `package.json` |
| PostgreSQL version (Neon production) | pg_version `18` | Neon project metadata (read-only, prior audit) |
| Redis | Used — `ioredis ^5.4.1`, `@socket.io/redis-adapter ^8.3.0` | `package.json`, `src/realtime-redis.adapter.ts` |
| Socket.IO | Used — `socket.io ^4.7.5`, `@nestjs/platform-socket.io ^10.3.8`, `@nestjs/websockets ^10.3.8` | `package.json` |
| Firebase | Used — `firebase-admin ^12.1.0` (Firebase Auth bridge for OTP/identity) | `package.json`, `.env.example` (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) |
| Cloudflare R2 | Used (preferred storage) — `@aws-sdk/client-s3 ^3.637.0`, `@aws-sdk/s3-request-presigner ^3.637.0` (S3-compatible client used against R2 endpoint) | `.env.example` (`R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`) |
| Google Cloud Storage | Used as legacy/backward-compat storage — `@google-cloud/storage ^7.11.0` | `package.json`, `.env.example` (`GCS_BUCKET`) |
| Google Secret Manager | Used optionally at boot — `@google-cloud/secret-manager ^5.6.0` | `package.json`, `src/main.ts` (`loadSecretsIntoEnv()`), `.env.example` (`USE_SECRET_MANAGER`) |
| Google APIs (Routes/Maps) | Referenced via `OSRM_BASE_URL` (self-hosted OSRM routing engine is the primary route provider; Google Routes referenced in module names/comments) — **exact Google Routes API usage NOT VERIFIED in this pass** (requires reading `src/modules/geo`) | `.env.example`, schema comments (`routeProvider` field on `Trip`) |
| Payment gateway | Chargily Pay v2 (CIB / EDAHABIA) | `.env.example` (`CHARGILY_SECRET_KEY`, `CHARGILY_MODE`, etc.), `src/modules/payment-gateways` |
| SMS/Email providers | SMS: generic `SMS_API_URL`/`SMS_API_KEY`; Email: `resend`/`sendgrid`/`generic` via `EMAIL_PROVIDER` | `.env.example` |
| Voice/Call masking | Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_PROXY_NUMBERS`, etc.) or `chat_only`/`direct` modes | `.env.example`, `src/modules/calls` |
| Observability | Sentry (`SENTRY_DSN`), OpenTelemetry (`OTEL_*`), custom alert webhook (`ALERT_WEBHOOK_URL`) | `.env.example`, `src/common/observability/` |
| Deployment target(s) | Render (`web_service`, confirmed live production — see Section 29) **and** a Google Cloud Build / Cloud Run path also exists in-repo (`cloudbuild.yaml`, `Dockerfile`, `.gcloudignore`) — **NOT VERIFIED whether Cloud Run is actively deployed; Render is the confirmed live production target** | Render MCP (prior audit), root file listing (`cloudbuild.yaml`, `Dockerfile`) |

### What the server does

flaminGO (internal name NOVA Ride) is a ride-hailing backend: it onboards passengers, drivers, and vehicles; matches passengers with nearby drivers; computes fares (fixed pricing rules + peak pricing + an inDrive-style negotiated `FareQuote`/`FareOffer` flow); manages the full trip lifecycle (search → accept → arrive → in-progress → complete) with live GPS tracking; handles payments (cash, wallet/ledger, card via Chargily) and driver payouts; runs loyalty, referral, coupon, promo-code, and subscription-plan marketing systems; provides safety features (SOS, masked calling, trip-share links, lost items); supports passengers/drivers/agents/admin via role-based access; and exposes a set of admin/dashboard-facing modules (pricing admin, RBAC, settings publication workflow, content blocks, legal documents, feature flags, city scaling controls, reports, metrics).

---

## 2. Architecture

```
Client Apps (Passenger App / Driver App / Dashboard)
        │
        ▼
   NestJS HTTP API (Express adapter, prefix /api, versioned /api/v1)
        │
        ├── Global Guards: ThrottlerGuard → JwtAuthGuard → RolesGuard   (app.module.ts)
        ├── Global Interceptor: IdempotencyInterceptor
        ├── Global Filter: AllExceptionsFilter → ErrorReporterService (Sentry-capable)
        │
        ▼
   60+ Feature Modules (src/modules/*)
        │
        ▼
   Services (business logic)
        │
        ├──► PrismaModule ──► Prisma Client ──► PostgreSQL (Neon, production branch)
        ├──► RedisModule (ioredis) ──► Redis (caching, locks, driver geo, Socket.IO adapter, pub/sub)
        ├──► StorageModule ──► Cloudflare R2 (preferred, S3-compatible) / Google Cloud Storage (legacy)
        ├──► RealtimeModule / WebSocket Gateway ──► Socket.IO (Redis adapter for multi-instance)
        ├──► PaymentGatewayModule ──► Chargily Pay v2 (CIB/EDAHABIA)
        ├──► NotificationsModule ──► FCM (push), SMS provider, Email provider (resend/sendgrid/generic)
        ├──► Firebase Admin SDK ──► Firebase Auth (OTP/identity bridge)
        ├──► CallsModule ──► Twilio (voice masking) or chat_only/direct modes
        └──► ScheduleModule (@nestjs/schedule) ──► Cron jobs (only when APP_ROLE ≠ "api")
```

**Process roles** (`APP_ROLE` env var, read in `app.module.ts`):
- `api` — serves HTTP/WebSocket requests only; `ScheduleModule` is NOT loaded (cron decorators stay idle).
- `worker` — runs scheduled/cron jobs only.
- `all` (default) — both, in a single process. This is what a single-instance deployment (e.g. current Render service) runs.

This split exists so horizontal scaling doesn't duplicate cron-triggered financial/notification work across instances.

**Render production** currently runs the `all` role implicitly (no `APP_ROLE` override confirmed — **NOT VERIFIED FROM RENDER**, environment variable values were not read per the read-only/no-secrets rule).

---

## 3. Directory / File Structure

Verified via GitHub directory listing at commit `647dc78065e702c21d496909a655e72ed4910d43`.

### Repository root

| Path | Type | Purpose |
|---|---|---|
| `Dockerfile` | file | Container build definition (used for Cloud Build/Cloud Run path and/or local docker-compose) |
| `docker-compose.yml` | file | Local dev stack (app + Postgres + Redis, presumably — **exact services NOT VERIFIED in this pass**) |
| `cloudbuild.yaml` | file | Google Cloud Build pipeline definition (indicates a GCP deployment path exists in the repo) |
| `.dockerignore`, `.gcloudignore`, `.gitignore`, `.eslintignore` | files | Standard ignore files |
| `.eslintrc.js` | file | ESLint configuration |
| `.gitleaks.toml` | file | Gitleaks secret-scanning configuration (used by `security.yml`) |
| `.env.example` | file | Documents every environment variable name (see Section 33) — **no real values** |
| `tsconfig.json`, `tsconfig.strict.json` | files | TypeScript compiler configs (a stricter secondary config exists, used by `npm run typecheck:strict` in CI) |
| `nest-cli.json` | file | Nest CLI build configuration |
| `jest.config.js` | file | Jest test configuration |
| `package.json`, `package-lock.json` | files | Dependencies/scripts (see Sections 1, 32) |
| `prisma/` | dir | Prisma schema, migrations, seed script (see Section 10) |
| `src/` | dir | Application source (see below) |
| `scripts/` | dir | Operational/dev scripts (see Section 22 note and file list below) |
| `test/` | dir | Test suite root (contents **NOT enumerated in this pass** — see Section 31) |
| `assets/`, `official-assets/` | dirs | Static asset directories used by asset-publishing scripts |
| `docs/` | dir | Additional documentation (contents **NOT enumerated in this pass**) |
| `.github/workflows/` | dir | CI/CD workflows (see Section 30) |
| `P0_FINANCIAL_HARDENING.md`, `PRISMA_BASELINE.md`, `README_STAGE_A.md`…`README_STAGE_F.md`, `RUNBOOKS.md`, `SECURITY_FIX_REPORT.md`, `SERVER_STATUS_REPORT.md`, `UPGRADE_PLAN.md` | files | Historical/internal documentation from earlier development stages. **Content not re-verified in this pass** — treat as historical context, not as current source of truth (this document supersedes them for current backend state). |

### `src/` top level

| Path | Purpose |
|---|---|
| `src/main.ts` | Application bootstrap: secret loading, production safety checks, Helmet, body-size limits + raw-body capture for webhook HMAC verification, CORS, global API prefix `/api` + URI versioning (`/api/v1/...` and version-neutral), global `ValidationPipe`, Swagger (conditionally enabled), global exception filter, unhandled-rejection/exception capture, graceful shutdown hooks, Redis-backed Socket.IO adapter, HTTP listen. |
| `src/app.module.ts` | Root module: wires all 60 feature modules, global `ConfigModule`, `ThrottlerModule` (120 req/60s default), conditional `ScheduleModule`, global guards (Throttler → JWT → Roles) and global `IdempotencyInterceptor`. |
| `src/realtime-redis.adapter.ts` | Custom Socket.IO adapter wiring the Redis pub/sub adapter for multi-instance WebSocket support. |
| `src/common/` | Cross-cutting concerns: guards (`jwt-auth.guard`, `roles.guard`), filters (`all-exceptions.filter`), interceptors (`idempotency.interceptor`), observability (`structured-logger.service`, `error-reporter.service`, `observability.module`), security (`cors-origins`), infra (`infra.module`), api (`api-meta.module`). Full sub-file inventory **NOT VERIFIED in this pass**. |
| `src/config/` | `configuration.ts` (typed config loader) and `secrets.ts` (`loadSecretsIntoEnv` — Google Secret Manager bridge). |
| `src/prisma/` | `PrismaModule`/`PrismaService` wrapper around the Prisma Client. |
| `src/modules/` | All 60 feature modules — full list in Section 4. |

### `scripts/` (verified file list)

| Script | Purpose (inferred from filename/package.json script mapping) |
|---|---|
| `cleanup-legacy-files.mjs` | Removes legacy files (content not read — **NOT VERIFIED**) |
| `gen-openapi.mjs` | Generates OpenAPI spec (`npm run docs:api`) |
| `load-test.mjs` | Load testing (`npm run load`) |
| `logic-test.ts` | Business-logic test runner (`npm run test:logic`) |
| `publish-official-assets.mjs` | Publishes official static assets (`npm run assets:publish-official`) |
| `publish-vehicle-assets.mjs` | Publishes vehicle-type assets (`npm run assets:publish-vehicles`) |
| `seed-passenger-services.ts` | Passenger-services seed data (not directly mapped to a package.json script in the excerpt read — **NOT VERIFIED** if separately invoked) |
| `seed-passenger-stage2.ts` | `npm run seed:passenger-stage2` |
| `seed-passenger-stage3.ts` | `npm run seed:passenger-stage3` (via `tsx`) |
| `smoke.mjs` | Smoke test (`npm run smoke`) |

### `prisma/` (verified listing)

| Path | Purpose |
|---|---|
| `prisma/schema.prisma` (88,259 bytes) | Full data model — see Sections 7–9 |
| `prisma/seed.ts` | Seed script (`npm run seed`, and compiled/run in production as `node dist/prisma/seed.js` — see Section 28) |
| `prisma/migrations/` | Applied migration history (see Section 10) |
| `prisma/migrations_archive/` | Archived/superseded migrations — presence confirmed, **contents not enumerated in this pass** |
| `prisma/data/` | Presumably static seed data files — presence confirmed, **contents not enumerated in this pass** |

**Modules/controllers/services/repositories/guards/strategies/decorators/interceptors/filters/pipes/DTOs/utilities/providers/adapters**: The module-level directory names and root wiring are fully verified (Section 4). The internal file-by-file breakdown of every module (i.e. which files are controllers vs. services vs. DTOs inside each of the 60 `src/modules/*` folders) was **NOT enumerated file-by-file in this pass** — only two representative common-layer files (`jwt-auth.guard`, `idempotency.interceptor`) were confirmed by name via `app.module.ts` imports. A full per-file breakdown requires listing each module directory individually and is flagged as follow-up work (Section 34).

---

## 4. NestJS Modules — Full Inventory

All 60 module directories confirmed to exist under `src/modules/` via GitHub directory listing, and cross-checked against the modules actually imported into `AppModule` (`src/app.module.ts`). Every directory listed below **is** imported into `AppModule` except where noted.

| # | Module (directory) | Imported in AppModule? |
|---|---|---|
| 1 | `ads` | ✅ `AdsModule` |
| 2 | `agents` | ✅ `AgentsModule` |
| 3 | `app-versions` | ✅ `AppVersionsModule` |
| 4 | `assets` | ✅ `AssetsModule` |
| 5 | `auth` | ✅ `AuthModule` |
| 6 | `backups` | ✅ `BackupsModule` |
| 7 | `bootstrap` | ✅ `BootstrapModule` |
| 8 | `calls` | ✅ `CallsModule` |
| 9 | `city-scaling` | ✅ `CityScalingModule` |
| 10 | `content-blocks` | ✅ `ContentBlocksModule` |
| 11 | `country-config` | ✅ `CountryConfigModule` |
| 12 | `coupons` | ✅ `CouponsModule` |
| 13 | `dashboard` | ✅ `DashboardModule` |
| 14 | `drivers` | ✅ `DriversModule` |
| 15 | `emergency` | ✅ `EmergencyModule` |
| 16 | `fare-quotes` | ✅ `FareQuotesModule` |
| 17 | `financial` | ✅ `FinancialModule` |
| 18 | `geo` | ✅ `GeoModule` |
| 19 | `geography` | ✅ `GeographyModule` |
| 20 | `growth` | ✅ `GrowthModule` |
| 21 | `health` | ✅ (`HealthController` registered directly on `AppModule.controllers`, not via a module import) |
| 22 | `invoices` | ✅ `InvoicesModule` |
| 23 | `kyc` | ✅ `KycModule` |
| 24 | `legal` | ✅ `LegalModule` |
| 25 | `lost-items` | ✅ `LostItemsModule` |
| 26 | `loyalty` | ✅ `LoyaltyModule` |
| 27 | `managed-assets` | ✅ `ManagedAssetsModule` |
| 28 | `matching` | ✅ `MatchingModule` |
| 29 | `message-templates` | ✅ `MessageTemplatesModule` |
| 30 | `metrics` | ✅ `MetricsModule` |
| 31 | `notifications` | ✅ `NotificationsModule` |
| 32 | `payment-gateways` | ✅ `PaymentGatewayModule` |
| 33 | `payments` | ✅ `PaymentsModule` |
| 34 | `payouts` | ✅ `PayoutsModule` |
| 35 | `pooling` | ✅ `PoolingModule` |
| 36 | `pricing-engine` | ⚠️ Directory exists but **no direct import found** in `app.module.ts` (may be consumed internally by `pricing`/`fare-quotes` modules rather than imported at root — **NOT VERIFIED**) |
| 37 | `pricing` | ✅ `PricingAdminModule` (from `modules/pricing/pricing-admin.module`) |
| 38 | `profile-levels` | ⚠️ Directory exists but **no direct import found** in `app.module.ts` — **NOT VERIFIED** whether it's dead/legacy or consumed elsewhere |
| 39 | `promo-codes` | ✅ `PromoCodesModule` |
| 40 | `queue-insight` | ✅ `QueueInsightModule` |
| 41 | `rbac` | ✅ `RbacModule` |
| 42 | `realtime` | ✅ `RealtimeModule` |
| 43 | `redis` | ✅ `RedisModule` |
| 44 | `referral` | ✅ `ReferralModule` |
| 45 | `reports` | ✅ `ReportsModule` |
| 46 | `risk` | ✅ `RiskModule` |
| 47 | `scheduled-trips` | ✅ `ScheduledTripsModule` |
| 48 | `sessions` | ✅ `SessionsModule` |
| 49 | `settings` | ✅ `SettingsModule` **and** `FeatureFlagsModule` (both from `modules/settings/*`) |
| 50 | `storage` | ✅ `StorageModule` |
| 51 | `subscriptions` | ✅ `SubscriptionsModule` |
| 52 | `support` | ✅ `SupportModule` |
| 53 | `tips` | ✅ `TipsModule` |
| 54 | `translations` | ✅ `TranslationsModule` |
| 55 | `trip-communication` | ✅ `TripCommunicationModule` |
| 56 | `trips` | ✅ `TripsModule` |
| 57 | `users` | ✅ `UsersModule` |
| 58 | `vehicle-types` | ✅ `VehicleTypesModule` |

> Note: the directory listing returned 60 entries; two (`pricing-engine`, `profile-levels`) could not be matched to an explicit `AppModule` import statement in the excerpt read. This is flagged as `SOURCE CONFLICT`-adjacent — **not a contradiction found between two authoritative sources, but an unverified gap** — and should be resolved by reading those two module files directly in a follow-up pass before assuming they are dead code.

**Per-module detail (purpose, controllers, services, DB models, external dependencies)**: given the scale (58 wired modules), a full per-module breakdown table with controller/service/DTO-level detail was **NOT completed in this pass** — it requires opening each module's `.module.ts`, controller(s), and service(s) individually. What is verified here is the complete, authoritative **list** of modules and their wiring into `AppModule`, plus (in Section 7) every database model each module domain plausibly owns, derived directly from `schema.prisma`. Section 34 records this as an open follow-up item.

---

## 5–6. API Inventory & API Groups

**NOT VERIFIED — requires per-controller extraction.** A complete endpoint-by-endpoint inventory (HTTP method, full path, DTO, auth/role, side effects, etc.) requires reading every controller file across all 58 wired modules. This was not completed in this audit pass and is **not fabricated** here per the no-guessing rule.

What is verified from `src/main.ts`:
- Global prefix: `/api`
- Versioning: URI-based, default version is both `1` and version-neutral (so both `/api/...` and `/api/v1/...` resolve to the same handlers unless a controller overrides its version)
- Swagger/OpenAPI UI is available at `/api/docs` (enabled outside production by default; in production only if `ENABLE_SWAGGER=true`)
- Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` — unknown/extra body fields are rejected on every endpoint
- Global guard order: `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard` — **every route is protected by default** unless explicitly marked `@Public()` in code (per the comment in `app.module.ts`); this is a strong default-secure posture

Based on module names alone (not endpoint extraction), the plausible **API groups** that exist are: Authentication (`auth`), Users (`users`, `sessions`, `kyc`), Drivers (`drivers`), Trips (`trips`, `scheduled-trips`, `pooling`, `matching`), Tracking (`trips`/`TripTracking` — no dedicated module, lives inside `trips`), Geography (`geo`, `geography`), Pricing (`pricing`, `pricing-engine`, `fare-quotes`), Wallet/Payments (`payments`, `payment-gateways`, `financial`, `payouts`, `tips`, `invoices`), Loyalty/Growth (`loyalty`, `referral`, `growth`, `subscriptions`, `promo-codes`, `coupons`), Notifications/Messaging (`notifications`, `message-templates`, `trip-communication`), SOS/Safety (`emergency`, `calls`, `lost-items`), Support (`support`), Documents (`kyc`, driver documents live inside `drivers`), Vehicles (`vehicle-types`), Agents (`agents`), Admin/Dashboard (`dashboard`, `rbac`, `settings`, `city-scaling`, `country-config`, `risk`, `reports`, `queue-insight`, `backups`), Ads (`ads`), Assets (`assets`, `managed-assets`), Metrics/Health (`metrics`, `health`), Legal (`legal`), Content (`content-blocks`, `translations`), Realtime (`realtime`). This grouping is inferred from module names, not from confirmed route tags — **NOT VERIFIED at the endpoint level**.

---

## 7. Database — Complete Inventory

Source: `prisma/schema.prisma` (88,259 bytes) at commit `647dc78065e702c21d496909a655e72ed4910d43`, cross-checked for `TripTracking` specifically against live Neon Production structure (prior READ-ONLY audit, same day).

**Generator/datasource**: `provider = "prisma-client-js"`; `datasource db { provider = "postgresql", url = env("DATABASE_URL") }`.

Given the schema defines **90+ models**, this document lists every model **name** and its evident purpose/key relations (from the schema itself), rather than reproducing every column for every model verbatim (which would make this document unmanageably long without added value over the schema file itself). For column-level detail on any specific table, `prisma/schema.prisma` is the authoritative source, and this document explicitly defers to it.

### Core identity & RBAC
- **User** — core identity for all actors (`type`: PASSENGER/DRIVER/STAFF/AGENT); unique phone/email/username/firebaseUid; links to almost every other domain.
- **AccountDeletionRequest** — GDPR-style deletion workflow with `scheduledFor`.
- **Role**, **Permission**, **RolePermission** — RBAC join model.
- **Session**, **RefreshToken**, **DeviceToken** — auth session/device tracking.
- **UserConsent**, **LegalDocument**, **LegalDocumentVersion** — legal acceptance tracking.
- **UserIdentityVerification** — KYC (national ID/passport/driving license/residence permit).

### Drivers & vehicles
- **Driver** — status/availability, city/wilaya, current lat/lng, cancellation-strike/suspension fields, payout bank info.
- **DriverSanction** — cancellation penalty audit log.
- **DriverQrCode** — issued/revoked QR identifiers for drivers.
- **Vehicle** — plate (unique), rideClass, vehicleType relation, verification status.
- **DriverDocument** — license/ID/insurance/carte grise/technical inspection/vehicle front photo, with status + reviewer.
- **VehicleType** (referenced by `Vehicle`, `Trip`, `PricingRule` etc. — module `vehicle-types`).

### Trips & tracking
- **Trip** — the central trip record: passenger/driver, status enum, rideClass, pickup/dest coordinates, route polyline + provider, fare, commission, payment method, cancellation fields, coupon linkage, settlement status/attempts, scheduling fields, archive timestamp.
- **TripMessage** — in-trip chat (sender, body, readAt).
- **TripTracking** — **partitioned table** (`PARTITION BY RANGE (recordedAt)`, composite PK `(id, recordedAt)`) — see Section 11 for full detail.
- **TripEvent** — generic event/audit log per trip (`type`, `actor`, `meta` JSON).
- **TripArchive** — cold snapshot of completed trips (JSON snapshot + counts) for long-term retention after hot-table cleanup.
- **TripShareToken** — hashed, expiring public trip-tracking links.
- **TripTip** — passenger→driver tips (1:1 per trip).
- **CallSession** — masked-call session metadata (proxy number, caller/callee roles).

### Financial / ledger
- **FinancialParty**, **FinancialAccount**, **LedgerTransaction**, **LedgerEntry** — double-entry ledger system (replaces a legacy wallet model).
- **LedgerReconciliationIncident** — automatic detection of cached-vs-derived balance mismatches.
- **LegacyWalletArchive** — non-operational audit snapshot of the pre-ledger wallet data (explicitly documented in schema comments as **not used for balance calculation**).
- **DriverEarning**, **CompanyEarning** — per-trip earning splits.
- **Payment**, **PaymentEvent** — payment lifecycle + provider webhook event log.
- **DriverFundingRequest**, **DriverTransfer**, **WithdrawRequest** — driver-initiated money movement workflows with approval steps.
- **PayoutBatch**, **PayoutItem** — payout batch settlement records.

### Marketing / growth
- **Coupon**, **CouponRedemption** — code-based discounts with per-user limits.
- **PromoCode**, **PromoCodeRedemption** — separate promo-code system with a unique `(promoCodeId, userId)` constraint to prevent double redemption.
- **ReferralCode**, **Referral** — referral program (referrer/referee reward tracking).
- **LoyaltyAccount**, **LoyaltyLedger** — points balance + immutable ledger, tiers BRONZE/SILVER/GOLD/PLATINUM.
- **SubscriptionPlan**, **UserSubscription** — recurring passenger subscription plans (MONTHLY/QUARTERLY/YEARLY).
- **Incentive**, **DriverIncentiveProgress** — driver incentive campaigns.
- **PricingExperiment**, **ExperimentAssignment** — A/B pricing experiments with deterministic per-subject variant assignment.

### Geography & pricing
- **Wilaya** — Algeria's 69 administrative provinces (table, not enum, specifically because the count has changed historically); `isActive` vs `isOperational` distinction.
- **City**, **Zone** — city and city-zone (polygon) records.
- **PricingRule**, **PeakPricing** — city/wilaya/national-scoped fare rules with time-window peak multipliers.
- **CityScalingControl** — per-city launch status and capacity caps.

### Safety / support
- **EmergencyContact** — user emergency contacts.
- **SafetyIncident** — SOS/accident/threat/medical reports with acknowledgement/resolution workflow.
- **LostItem** — lost-item reports per trip.
- **SupportTicket**, **SupportMessage** — support ticketing with SLA/escalation fields.
- **Rating**, **Complaint** — post-trip rating and complaint handling.

### Fare negotiation (inDrive-style)
- **FareQuote** — suggested/min/max fare with expiry.
- **FareOffer** — driver counter-offers against a `FareQuote`.

### Platform / admin / content
- **Setting**, **SettingChangeRequest**, **SettingRevision** — versioned, publishable settings with an approval workflow (draft → change request → published).
- **AppVersion** — mobile app version/force-update control.
- **Notification**, **UserNotificationState** — notification content + durable per-user delivery/read state with retry/backoff fields (`attempts`, `maxAttempts`, `nextAttemptAt`).
- **MessageTemplate** — localized transactional/marketing/system/support templates.
- **ContentBlock** — dashboard-managed dynamic in-app content (announcements/onboarding/FAQ/promo).
- **BackupRecord** — metadata log of external backup jobs (DB/files/full).
- **TranslationBundle** — versioned, per-locale server-driven translation bundles.
- **ManagedAsset** — versioned managed static assets (key/kind/audience/objectPath).
- **AgentProfile** — city-scoped agent accounts with creator/status tracking.
- **InvoiceSequence**, **Invoice** — sequential invoice numbering + issued invoice snapshots.

### Schema-vs-Neon comparison
- `TripTracking`: **confirmed identical** between `schema.prisma` (composite PK `(id, recordedAt)`, `@@index([tripId, recordedAt])`, `@@index([recordedAt])`) and live Neon Production structure (partitioned table, same PK, same two indexes, plus the FK — see Section 11). **No drift detected for this table.**
- All other tables: **not individually re-diffed against Neon Production in this pass** beyond the row-count spot checks already performed in the FINAL READ-ONLY AUDIT (Driver=11, Trip=96, User=12, TripTracking=51). A full schema-vs-database diff for all 90+ models is **NOT VERIFIED** and is recorded as a follow-up item (Section 34).

---

## 8. Database Relationships (selected core map)

Derived directly from `@relation` fields in `schema.prisma`. Only the most structurally central relations are shown; the full relation graph is the schema file itself.

```
User
├── Driver (1:1)
├── AgentProfile (1:1)
├── FinancialParty (1:1)
├── Trip (passengerId, 1:many, "PassengerTrips")
├── Payment, WithdrawRequest, RefreshToken, Session, DeviceToken (1:many)
├── Notification, UserNotificationState (1:many)
├── SupportTicket, SupportMessage, Rating (given/received), Complaint (filed/against/resolved)
├── EmergencyContact, SafetyIncident (reported/ack'd/resolved), LostItem (reported/resolved)
├── Invoice, TripTip (paid/received), UserConsent, SavedPlace, UserSubscription
├── UserIdentityVerification, DriverQrCode (issued/revoked), DriverTransfer (requested/reviewed)
└── AccountDeletionRequest, TripMessage (sent)

Driver
├── Vehicle (1:many)
├── DriverDocument (1:many)
├── Trip (driverId, 1:many, "DriverTrips")
├── DriverEarning, WithdrawRequest, DriverFundingRequest, DriverSanction, DriverQrCode
└── DriverTransfer (outgoing/incoming)

Trip
├── TripStop, SafetyIncident, TripShareToken, LostItem
├── Invoice (1:1), TripTip (1:1), CallSession, TripArchive (1:1)
├── TripTracking (1:many, partitioned)
├── TripEvent (1:many), Payment (1:1)
├── Rating (1:many), Complaint (1:many), TripMessage (1:many)
├── DriverEarning (1:1), CompanyEarning (1:1)
└── Coupon (many:1, optional)

Wilaya
├── City (1:many)
├── Driver (1:many, optional)
├── PricingRule, VehiclePricingRule (1:many)
└── AgentProfile (via City)

FinancialAccount
└── LedgerEntry (1:many) ── LedgerTransaction (many:1)

Coupon ── CouponRedemption (1:many)
PromoCode ── PromoCodeRedemption (1:many)
LoyaltyAccount ── LoyaltyLedger (1:many)
SubscriptionPlan ── UserSubscription (1:many)
FareQuote ── FareOffer (implicit via fareQuoteId, string reference — no formal FK, by design per schema comment)
```

---

## 9. Enums (full list from schema.prisma)

`UserType`, `UserStatus`, `AccountDeletionStatus`, `Gender`, `DriverStatus`, `DriverAvailability`, `RideClass`, `WorkflowStatus`, `DocumentType`, `DocumentStatus`, `TripStatus`, `SettlementStatus`, `ActorKind`, `PaymentMethod`, `PaymentStatus`, `WithdrawStatus`, `FundingRequestStatus`, `DriverTransferStatus`, `FinancialPartyType`, `FinancialAccountType`, `LedgerTransactionStatus`, `LedgerEntryDirection`, `AgentStatus`, `DriverQrStatus`, `DiscountType`, `CouponFundingSource`, `SubscriptionInterval`, `SubscriptionStatus`, `NotificationTarget`, `NotificationChannel`, `TicketStatus`, `ComplaintStatus`, `ReconciliationStatus`, `ReferralStatus`, `LoyaltyTier`, `LoyaltyEntryType`, `SafetyIncidentType`, `SafetyIncidentStatus`, `LostItemStatus`, `InvoiceStatus`, `TripTipStatus`, `SettingPublicationStatus`, `SettingChangeRequestStatus`, `LegalDocumentType`, `LegalAudience`, `SavedPlaceKind`, `FeatureFlagPlatform`, `FareQuoteStatus`, `FareOfferStatus`, `IdentityDocType`, `IdentityVerificationStatus`, `VehicleVerificationStatus`, `MessageTemplateCategory`, `ContentBlockType`, `ContentAudience`, `BackupKind`, `BackupStatus`, `BackupTrigger`, plus payout/incentive enums (`PayoutItemStatus`, `IncentiveKind`, `CityLaunchStatus` — referenced in the payouts/incentive/city-scaling models but their exact value lists were in the truncated middle portion of the schema read and are **NOT VERIFIED value-by-value in this pass**).

Business meaning for each enum's exact values (beyond what's self-evident from the name) was not individually annotated from code usage in this pass — this is standard Prisma enum documentation and each is self-describing from `schema.prisma` directly.

---

## 10. Prisma

| Field | Value |
|---|---|
| Prisma version | `^5.15.0` (client + CLI) |
| Schema location | `prisma/schema.prisma` |
| Generator | `prisma-client-js` |
| Datasource | `postgresql`, URL from `env("DATABASE_URL")` |
| Migrations directory | `prisma/migrations/` |
| Migration count (current) | **2** active migrations: `0_init`, `20260825122500_trip_tracking_partitioning` (plus `migration_lock.toml`) — confirmed via directory listing. An additional `prisma/migrations_archive/` directory exists holding **superseded** migrations (not counted as active). |
| Migration policy | development/test → migration review → CI → merge → production deploy → verification (formalized in Section 37 of this document going forward) |

### Current migration: `20260825122500_trip_tracking_partitioning`
Fully verified by reading the migration SQL directly (see prior FINAL READ-ONLY AUDIT, same commit): wrapped in `BEGIN`/`COMMIT`; renames the old table to `TripTracking_legacy`; creates a new partitioned `TripTracking` (`PARTITION BY RANGE ("recordedAt")`) plus a `TripTracking_default` partition; creates/replaces the `flamingo_ensure_tracking_partition(p_month DATE)` function; pre-creates several monthly partitions; copies data with `INSERT INTO ... SELECT`; runs a `DO $$ ... RAISE EXCEPTION` integrity check (row-count and id-set comparison) **before** dropping the legacy table; recreates indexes and the `tripId` FK (`ON DELETE CASCADE ON UPDATE CASCADE`); finally drops `TripTracking_legacy`.

### `0_init`
Baseline migration establishing the original schema. **Content not re-read in this pass** (previously established as the repository's baseline in earlier work); confirmed present via directory listing only.

### How migrations are created/applied
- **Created**: `npx prisma migrate dev` locally against a dev/test database (script: `npm run prisma:migrate`), which generates a new timestamped folder under `prisma/migrations/`.
- **Applied to Render production**: via the Render **Build Command**, which runs `npx prisma migrate deploy` on every deploy (confirmed current Build Command, Section 29). This applies any pending migrations non-interactively and is the only mechanism that touches the production schema during deploy.
- **Tracked**: Prisma records every applied migration in the `_prisma_migrations` table (name, checksum, `started_at`, `finished_at`, `applied_steps_count`, `rolled_back_at`) — confirmed present and consistent in Neon Production for both `0_init` and `20260825122500_trip_tracking_partitioning` as of the same-day audit.

**Confirmed explicitly**: `prisma migrate deploy` is the official, current production mechanism. `prisma db push --accept-data-loss` is **not** part of the current Render Build Command (verified literal string match in the FINAL READ-ONLY AUDIT).

---

## 11. TripTracking Partitioning

| Aspect | Detail | Evidence |
|---|---|---|
| Why partitioned | High-write-volume GPS ping table; monthly range partitioning keeps indexes small and allows old data to be dropped cheaply (whole partition drop vs. row-by-row delete) | migration SQL, `.env.example` (`TRIP_TRACKING_RETENTION_MONTHS`) |
| Partition key | `recordedAt` (must be part of the primary key for PostgreSQL declarative partitioning, hence the composite PK) | `schema.prisma`, migration SQL |
| relkind | `p` (partitioned parent table) | Neon Production (`pg_class.relkind`), confirmed same-day |
| Current partitions (as of 2026-08-25 audit) | `TripTracking_202608`, `TripTracking_202609`, `TripTracking_202610`, `TripTracking_default` | Neon Production, confirmed same-day |
| Default partition | `TripTracking_default` (bound `DEFAULT`, catches any row outside pre-created monthly ranges) | migration SQL + Neon confirmation |
| Partition-creation function | `flamingo_ensure_tracking_partition(p_month DATE)` — idempotent (`IF to_regclass(...) IS NULL THEN CREATE TABLE ... PARTITION OF`), returns the partition name | migration SQL, confirmed present in Neon |
| Future partition creation | Must be called (e.g. from a scheduled job — see below) with the target month before that month's data starts arriving; the function itself is idempotent and safe to call repeatedly | migration SQL |
| Retention | `TRIP_TRACKING_RETENTION_MONTHS` env var (default `3` per `.env.example`) — implies a retention/drop mechanism exists in code | `.env.example` |
| `ensureUpcomingPartitions()` / `dropExpiredPartitions()` cron functions | **NOT VERIFIED in this pass** — these are referenced by name in the user's own audit request (implying they exist in `src/modules/trips` or a scheduler service) but their exact file location, schedule, and test results were **not read in this pass** | — |
| Indexes | `TripTracking_recordedAt_idx`, `TripTracking_tripId_recordedAt_idx`, plus the PK index `TripTracking_pkey` | schema + Neon confirmation |
| PK | `TripTracking_pkey — PRIMARY KEY (id, "recordedAt")` | Neon confirmation |
| FK | `TripTracking_tripId_fkey → Trip(id)`, `ON UPDATE CASCADE ON DELETE CASCADE` | schema + Neon confirmation |
| Operational considerations | Because `recordedAt` is part of the PK, any UPDATE of that column requires special handling (not standard for an append-only tracking table); default partition exists to prevent insert failures if a future month's partition is missing | inferred from migration design |
| Race conditions tested | **NOT VERIFIED in this pass** — no evidence read confirming a specific race-condition test was executed against `flamingo_ensure_tracking_partition` concurrency |
| `dropExpiredPartitions` test result | **NOT VERIFIED in this pass** |

**Current actual production state** (from the same-day FINAL READ-ONLY AUDIT): 51 rows total, `min(recordedAt)` = `2026-08-09T19:33:37.707Z`, `max(recordedAt)` = `2026-08-21T20:18:50.466Z`, no unexpected legacy/new/test partitions present, `_prisma_migrations` row for this migration shows `applied_steps_count=1`, `rolled_back_at=null`.

---

## 12. Authentication & Authorization

- **JWT**: `@nestjs/jwt` + `passport-jwt`; access/refresh secrets are separate env vars (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) with TTLs (`JWT_ACCESS_TTL=15m`, `JWT_REFRESH_TTL=30d` defaults). `src/main.ts` **refuses to boot in production** if these secrets are missing or still have default/dev placeholder values (`change-me`/`dev-` prefixes) — a real hard safety check, not just documentation.
- **Firebase Auth bridge**: `firebase-admin` verifies Firebase ID tokens from the passenger/driver apps; controlled by `AUTH_OTP_CHANNEL=firebase` (alternative: `sms`). If Firebase env vars are empty, the bridge is disabled but the rest of the app still boots (per `.env.example` comment).
- **Sessions & refresh tokens**: dedicated `Session` and `RefreshToken` Prisma models; refresh tokens are stored hashed (`tokenHash`) with `revoked`/`expiresAt` fields, indexed by `(userId, revoked)` and `(userId, sessionId, revoked)` for fast lookup/revocation.
- **Guards**: Global guard chain `ThrottlerGuard → JwtAuthGuard → RolesGuard`, applied to **every route by default**; a route must be explicitly marked `@Public()` (per code comment in `app.module.ts`) to bypass JWT — this is a secure-by-default posture.
- **Roles**: `RbacModule` + `Role`/`Permission`/`RolePermission` models provide a DB-backed permission system in addition to the `UserType` enum (PASSENGER/DRIVER/STAFF/AGENT) used for coarse-grained routing.
- **Agent authentication**: `AgentProfile` model (linked 1:1 to `User`, `type = AGENT`), city-scoped, with a `status` (ACTIVE/SUSPENDED/INVITED) and creator/last-login tracking — handled via the `agents` module.
- **Driver/Passenger/Admin/Staff authentication**: all share the same `User`+JWT+guard mechanism, differentiated by `UserType` and RBAC roles, not separate auth systems.
- **Login/verification flow**: **NOT VERIFIED at the code/handler level in this pass** (would require reading `src/modules/auth` controllers/services) — the above is inferred from schema + `main.ts` + `app.module.ts` wiring, which is real evidence, but the exact request/response flow of e.g. `POST /api/v1/auth/login` was not read.

---

## 13. Security

| Control | Status | Evidence |
|---|---|---|
| Helmet | ✅ Enabled (`app.use(helmet())`) | `src/main.ts` |
| CORS | ✅ Explicit allow-list via `CORS_ORIGINS` env var, shared resolver (`resolveCorsOptions`) used for both HTTP and WebSocket; production **refuses to boot** if `CORS_ORIGINS` is empty or literally `"*"` | `src/main.ts` |
| Rate limiting | ✅ Global `ThrottlerGuard`, 120 requests / 60 seconds default (`ThrottlerModule.forRoot`) | `src/app.module.ts` |
| Input validation | ✅ Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` — rejects any unexpected field on every DTO | `src/main.ts` |
| Sanitization | **NOT VERIFIED** (no explicit sanitization library found in `package.json`; relies on `class-validator` + Prisma parameterization) | — |
| Authentication | ✅ See Section 12 | — |
| Authorization | ✅ See Section 12 (global `RolesGuard` + DB-backed RBAC) | — |
| CSRF | **NOT VERIFIED / likely not applicable** — this is a token-based (JWT bearer) API consumed by mobile apps and a dashboard, not a cookie-session web app, so CSRF protection is not expected to be present and none was found | — |
| SQL injection protection | ✅ Prisma Client used throughout (parameterized queries by construction); no raw SQL string interpolation found in the files read | `schema.prisma`, `package.json` (`@prisma/client`) |
| File upload security | **NOT VERIFIED in this pass** — `multer` is present only via an `overrides` pin in `package.json` (`"multer": "2.2.0"`, a transitive dependency pin, likely for a security fix — see `SECURITY_FIX_REPORT.md`), not confirmed as directly used; storage module details not read |
| Secrets handling | ✅ No secrets committed in `.env.example` (all values blank/placeholder); optional Google Secret Manager integration at boot (`loadSecretsIntoEnv`); production boot explicitly validates presence of `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `PAYMENT_WEBHOOK_TOKEN`, `METRICS_TOKEN` and rejects weak/default JWT secrets | `src/main.ts`, `.env.example` |
| Dependency audit | ✅ CI-enforced: `security.yml` runs `gitleaks detect` (secret scanning, blocking) and `npm audit --omit=dev --audit-level=high` (blocking on production deps) plus a non-blocking full audit report; a separate `dependency-audit-report.yml` and `security-fix-apply.yml` exist (content **not read in this pass**) | `.github/workflows/security.yml` (read in full) |
| Security headers | ✅ via Helmet | `src/main.ts` |
| Logging | ✅ Structured JSON logger (`StructuredLogger`) with request/trace/actor correlation fields; unhandled promise rejections and uncaught exceptions are explicitly captured and reported, not just left to crash silently | `src/main.ts` |
| Sensitive data protection | ✅ Refresh tokens stored hashed; trip-share tokens stored hashed (`tokenHash`); webhook signature verification uses raw body capture (`rawBody`) specifically to prevent signature-bypass via JSON re-serialization | `src/main.ts`, `schema.prisma` |

No security control is claimed here beyond what was directly observed in `src/main.ts`, `app.module.ts`, `.env.example`, `package.json`, and `security.yml`.

---

## 14. Socket.IO / Realtime

- **Confirmed infrastructure**: `RealtimeModule` (`src/modules/realtime`) is wired into `AppModule`; `RedisIoAdapter` (`src/realtime-redis.adapter.ts`) is installed as the global WebSocket adapter in `main.ts`, backed by Redis pub/sub for multi-instance support; CORS for WebSocket connections shares the same `resolveCorsOptions` resolver as HTTP.
- **Specific event names/payloads** (e.g. `ride:searching`, `ride:no_drivers`, `ride:error`, `ride:accepted`, and any others): **NOT VERIFIED in this pass** — this requires opening the gateway file(s) inside `src/modules/realtime` (and possibly `src/modules/matching` / `src/modules/trips`), which was not done in this audit pass. This document does not assert these events exist with the exact names given in the request, nor does it deny it — it is explicitly unverified.

---

## 15. Cron / Background Jobs

- **Scheduling infrastructure**: `@nestjs/schedule` (`ScheduleModule`) is loaded **only** when `SCHEDULER_ENABLED` is true, i.e. when `APP_ROLE` is `worker` or `all` (default) — confirmed in `app.module.ts`. When `APP_ROLE=api`, `@Cron`-decorated methods anywhere in the codebase become inert.
- **Specific jobs** (names, schedules, timezones, specifically `ensureUpcomingPartitions()` / `dropExpiredPartitions()`): **NOT VERIFIED in this pass** — would require searching every module's services for `@Cron(...)` decorators, which was not done. Their *existence* is strongly implied by `.env.example` (`TRIP_TRACKING_RETENTION_MONTHS`, `TRIP_ARCHIVE_ENABLED`, `TRIP_ARCHIVE_AFTER_MONTHS`, `TRIP_ARCHIVE_BATCH_SIZE`) and by the partitioning function `flamingo_ensure_tracking_partition` needing a caller, but the calling job itself was not located in this pass.

---

## 16. Redis

- **Library**: `ioredis ^5.4.1`; dedicated `RedisModule` (`src/modules/redis`).
- **Confirmed use**: Socket.IO adapter (`@socket.io/redis-adapter`, via `RedisIoAdapter`) for multi-instance WebSocket pub/sub.
- **Connection**: `REDIS_URL` env var (required in production per `main.ts` boot check).
- **Other specific uses** (distributed locks, caching, driver geo storage, key patterns/TTLs): **NOT VERIFIED in this pass** — the `AppRole` doc-comment in `app.module.ts` explicitly mentions "القفل الموزّع" (distributed lock) as a reason for the api/worker split, implying locks are used, but the exact implementation was not read.

---

## 17. Storage

- **Preferred provider**: Cloudflare R2, accessed via the S3-compatible AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`). Config: `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (all required together per `.env.example` comment), optional `R2_PUBLIC_URL` for direct public reads (else signed URLs).
- **Legacy/backward-compat provider**: Google Cloud Storage (`@google-cloud/storage`), `GCS_BUCKET`.
- **Module**: `StorageModule` (`src/modules/storage`).
- **Specific service methods** (`StorageService` upload/delete/read-URL/public-URL, avatarUrl handling, document images, profile frames, asset publishing): **NOT VERIFIED in this pass at the code level** — only the provider configuration and dependency choice are confirmed. `scripts/publish-official-assets.mjs` and `scripts/publish-vehicle-assets.mjs` confirm asset-publishing scripts exist and are wired into `package.json` scripts.

---

## 18. External Services

| Service | Purpose | Integration | Env var names (no values) | Used by (module, where evident) |
|---|---|---|---|---|
| Firebase | Auth (OTP/identity bridge), possibly push (FCM overlaps) | `firebase-admin` SDK | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | `auth` (inferred) |
| FCM | Push notifications | HTTP (server key) | `FCM_SERVER_KEY` | `notifications` |
| SMS provider (generic) | OTP/alerts via SMS | Generic HTTP | `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER` | `auth`/`notifications` (inferred) |
| Email provider | Transactional email | resend / sendgrid / generic | `EMAIL_PROVIDER`, `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_TIMEOUT_MS`, `EMAIL_BRAND_*`, `EMAIL_SUPPORT_ADDRESS`, `EMAIL_APP_URL` | `notifications` (inferred) |
| Cloudflare R2 | Object storage | S3-compatible (AWS SDK) | `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` | `storage` |
| Google Cloud Storage | Legacy object storage | `@google-cloud/storage` | `GCS_BUCKET` | `storage` |
| Google Secret Manager | Optional boot-time secret injection | `@google-cloud/secret-manager` | `USE_SECRET_MANAGER`, `GCP_PROJECT_ID` | `src/config/secrets.ts` |
| OSRM (self-hosted routing) | Route/distance/duration calculation | HTTP | `OSRM_BASE_URL` | `geo` (inferred) |
| Chargily Pay v2 | Card payments (CIB/EDAHABIA) | HTTP + webhooks | `CHARGILY_SECRET_KEY`, `CHARGILY_MODE`, `CHARGILY_BASE_URL`, `CHARGILY_DEFAULT_METHOD`, `CHARGILY_WEBHOOK_URL`, `CHARGILY_SUCCESS_URL`, `CHARGILY_FAILURE_URL`, `CHARGILY_LOCALE` | `payment-gateways` |
| Twilio | Masked voice calls | HTTP + webhooks | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PROXY_NUMBERS`, `TWILIO_WEBHOOK_BASE_URL`, `TWILIO_DIAL_TIMEOUT_SEC`, `TWILIO_RECORD_CALLS` | `calls` |
| Sentry | Error monitoring | SDK (implied — not seen directly in `package.json` dependency list read; may be optional/lazy-loaded) | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_MAX_EVENTS_PER_MINUTE` | `common/observability` |
| OpenTelemetry | Tracing | Env-configured exporter | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_MAX_BATCH`, `OTEL_FLUSH_INTERVAL_MS`, `TRACING_ENABLED` | `common/observability` |
| Redis | Cache/locks/Socket.IO adapter | `ioredis` | `REDIS_URL` | `redis`, realtime |
| Neon | Managed PostgreSQL | Prisma over `DATABASE_URL` | `DATABASE_URL`, (`DIRECT_URL`/`SHADOW_DATABASE_URL` used only in CI per `ci.yml`) | all modules via Prisma |
| Render | Hosting/deploy | Build/Start Command | n/a (platform-level) | production runtime |
| Custom alert webhook | Ops alerting | HTTP | `ALERT_WEBHOOK_URL`, `ALERT_THROTTLE_MS` | `common/observability` |

---

## 19–27. Business Systems (Pricing, Geography, Loyalty, Payments/Wallet, Notifications, Documents, Driver/Vehicle, Trip Lifecycle)

Given the breadth requested here duplicates and would require the same per-controller/per-service code reading flagged as not completed in Sections 5–6, 14–17, this section documents what is **structurally confirmed from the schema and configuration** and explicitly flags business-logic detail as unverified rather than inventing rules.

### 20. Pricing (confirmed structure)
- `PricingRule` scoped by `cityId` (optional) and `wilayaId` (optional) with `rideClass`, `baseFare`, `perKm`, `perMin`, `minFare`, `maxFare`, `currency`, `isActive`.
- `PeakPricing` — time-window (`startTime`/`endTime`/`daysOfWeek`) multiplier per `PricingRule`.
- Priority model per schema comment: **city > wilaya > national**, resolved in code by a `resolveLegacy()`-style function (name referenced in schema comment) — **not** a manual priority column, specifically to prevent an admin from creating an illogical override. Exact resolution algorithm **NOT VERIFIED in this pass** (requires reading `pricing`/`pricing-engine` services).
- `FareQuote`/`FareOffer` — separate inDrive-style negotiated pricing flow (suggested + min/max range, driver counter-offers), decoupled from `PricingRule` by design (string-keyed, no FK) per schema comments.
- `PricingExperiment`/`ExperimentAssignment` — A/B testing infrastructure exists; active experiment key configured via `PRICING_EXPERIMENT_KEY` env var.
- Known security-relevant note found directly in schema comments: **server-side validation of fare quotes is implied by design** (min/max bounds stored server-side), but the actual validation code path was **NOT VERIFIED in this pass**.

### 21. Geography Algeria (confirmed structure)
- `Wilaya` — table (not enum) of all Algerian wilayas, deliberately chosen because the count changed historically (48→58→69, per schema comment); `number` (1–69) and ISO `code` (`DZ-NN`) both unique.
- `City` — optionally linked to a `Wilaya` (nullable FK, `onDelete: SetNull`) specifically to avoid breaking pre-existing city data that predates the wilaya rollout.
- `Zone` — polygon-based sub-city zones.
- Endpoints and exact pricing-resolution/dashboard-control behavior: **NOT VERIFIED in this pass**.

### 22. Loyalty / Points (confirmed structure)
- `LoyaltyAccount.pointsBalance` (spendable), `lifetimePoints` (cumulative, drives `tier`), `tier` (BRONZE/SILVER/GOLD/PLATINUM).
- `LoyaltyLedger` — immutable per-entry log (`EARN`/`REDEEM`/`ADJUST`), each with a unique `idempotencyKey`.
- Env-configured thresholds: `LOYALTY_TIER_SILVER=1000`, `LOYALTY_TIER_GOLD=5000`, `LOYALTY_TIER_PLATINUM=20000`, `LOYALTY_POINTS_PER_UNIT=1`, `LOYALTY_REDEEM_POINTS_PER_UNIT=100`, `LOYALTY_MIN_REDEEM_POINTS=500`.
- The three specific point fields requested for clarification (`lifetimeTierPoints`, `tierPoints`, `rewardPoints`) **do not appear under those exact names** in the schema as read — the actual model uses `pointsBalance` and `lifetimePoints`. This is flagged explicitly as a naming difference from the request rather than guessed at: **the requested field names are NOT VERIFIED to exist; the schema's actual field names are `pointsBalance` and `lifetimePoints`.**
- Completeness: structurally present (account + ledger + tiers + env-config), but whether the full grant/spend business logic is **fully implemented vs. partially implemented** was **NOT VERIFIED in this pass** (would require reading the `loyalty` module's services) — this document does **not** claim `PARTIALLY IMPLEMENTED` or `COMPLETE` without that evidence.

### 23. Payments / Wallet (confirmed structure)
- Ledger-first design: `FinancialParty` → `FinancialAccount` → `LedgerTransaction`/`LedgerEntry` (double-entry, `DEBIT`/`CREDIT`), with `LedgerReconciliationIncident` for automatic cached-vs-derived balance drift detection.
- `LegacyWalletArchive` explicitly documented in-schema as a **non-operational audit snapshot only** — confirms a wallet→ledger migration happened historically and the old model is retired from write paths.
- `Payment`/`PaymentEvent` — payment status lifecycle (PENDING→AUTHORIZED→CAPTURED→PAID / FAILED / REFUNDED / CANCELED) with a provider-event audit trail and unique `idempotencyKey` on events.
- Chargily webhook signature verification is supported by the raw-body capture in `main.ts` (`PAYMENT_WEBHOOK_TOKEN` required in production boot check).
- Idempotency: enforced globally via `IdempotencyInterceptor` (all mutating requests) plus explicit `idempotencyKey` unique constraints on `PaymentEvent`, `DriverFundingRequest`, `DriverTransfer`, `SafetyIncident`, `LoyaltyLedger` entries.
- Refunds/exact balance-calculation code paths: **NOT VERIFIED in this pass**.

### 24. Notifications (confirmed structure)
- `Notification` model has durable-delivery fields (`deliveryStatus` reusing an `OutboxStatus`-style enum, `attempts`, `maxAttempts` default 8, `nextAttemptAt`, `lastError`) — indicates an outbox/retry pattern, not fire-and-forget.
- `UserNotificationState` — per-user read/delete state, unique per `(userId, notificationId)`.
- `MessageTemplate` — localized, categorized (TRANSACTIONAL/MARKETING/SYSTEM/SUPPORT) templates.
- Exact FCM/SMS/email dispatch code and any known gaps: **NOT VERIFIED in this pass**.

### 25. File Uploads / Documents (confirmed structure)
- `DocumentType` enum: `LICENSE`, `ID_CARD`, `INSURANCE`, `REGISTRATION` (legacy alias), `PROFILE_PHOTO`, `CARTE_GRISE`, `TECHNICAL_INSPECTION`, `VEHICLE_FRONT_PHOTO` — schema comments explicitly document that `VEHICLE_FRONT_PHOTO` **replaced** a VTC-permit document type, and `REGISTRATION` is kept only for legacy records.
- `DocumentStatus`: `PENDING`/`APPROVED`/`REJECTED`/`EXPIRED`.
- `DriverDocument` has `issuedAt`/`expiresAt` and a `reviewedById` (admin approval trail).

### 26. Driver / Vehicle System (confirmed structure)
- Driver registration collects wilaya only (not city) at signup per schema comment ("المرحلة ب"), because city lists are incomplete for many wilayas; `cityId` remains for backward compatibility/city-level pricing, filled in later from the dashboard.
- `Vehicle.verificationStatus` (PENDING/APPROVED/REJECTED) with reviewer/timestamp.
- Availability: `DriverAvailability` (OFFLINE/ONLINE/ON_TRIP).
- Matching/dispatch algorithm: **NOT VERIFIED in this pass** (module `matching` exists but was not read).

### 27. Trip Lifecycle (confirmed from `TripStatus` enum + fields)
`SCHEDULED → SEARCHING → ACCEPTED → ARRIVING → IN_PROGRESS → COMPLETED` (or `CANCELLED` at any point), with supporting timestamp fields on `Trip` (`acceptedAt`, `startedAt`, `completedAt`, `settledAt`, `archivedAt`) and a cancellation-penalty subsystem (`Driver.cancellationStrikes`, `suspendedUntil`, `DriverSanction`). Exact request→quote→matching→payment→rating orchestration code: **NOT VERIFIED in this pass**.

---

## 28. Seed System

- **Command**: `npm run seed` → `ts-node prisma/seed.ts` (dev); in production, the compiled seed runs as `node dist/prisma/seed.js` as the **final step of the Render Build Command** (confirmed literal string, Section 29).
- **What it seeds**: **NOT VERIFIED in this pass** — `prisma/seed.ts` (20,618 bytes) was not opened in this pass; additional stage-specific seed scripts exist (`seed-passenger-stage2.ts`, `seed-passenger-stage3.ts`, `seed-passenger-services.ts`) suggesting incremental/staged seed data, but their content and idempotency were not verified.
- **Idempotency**: **NOT VERIFIED** — must be assumed non-destructive given it runs on every production deploy, but this was not confirmed by reading the seed script's actual logic (e.g. whether it uses `upsert` throughout).
- **Production implication**: because `node dist/prisma/seed.js` runs on every Render deploy after `migrate deploy`, the seed script **must** be idempotent/safe to re-run repeatedly against a live database with existing data — this is a critical assumption that should be explicitly verified by reading `prisma/seed.ts` in a follow-up pass (flagged in Section 34 as a risk pending verification, not a confirmed defect).

---

## 29. Render Production

(Carried forward from the same-day FINAL READ-ONLY AUDIT, re-stated here for this baseline; values that are secret are represented only by variable name.)

| Field | Value |
|---|---|
| Service name | Backend |
| Service ID | `srv-d97fsb3eo5us739s2s9g` |
| Service type | `web_service` |
| Repository | `taha3ben-web/Backend` |
| Branch | `main` |
| Root Directory | `""` (repository root) |
| Runtime | `node` |
| Region | `frankfurt` |
| Production URL | `https://backend-diao.onrender.com` |
| Build Command | `npm install --include=dev && npx prisma generate && npm run build && npx prisma migrate deploy && node dist/prisma/seed.js` |
| Start Command | `node dist/src/main.js` |
| Deployment strategy | Push-to-`main`-triggered deploy (plus manual/settings-update-triggered deploys observed) |
| Health check | `/api/health/live` (observed returning 200 repeatedly in logs) — exact Render-configured health-check path setting **NOT VERIFIED FROM RENDER** (only observed via logs, not via a `get_service` health-check field read) |
| Cron jobs on Render | **NOT VERIFIED** — no separate Render Cron Job service was found in the single-service workspace observed; scheduled jobs (if any) run inside the same web service process per the `APP_ROLE` mechanism (Section 2, 15) |
| Environment variables | **NOT VERIFIED FROM RENDER** (no read tool for env var names/values exists in the current Render MCP connection — see Section 33 for names derived from code instead) |

---

## 30. GitHub Actions

| Workflow file | Trigger | Purpose | Jobs | Secrets used (names only) | Production access? | Can modify database? |
|---|---|---|---|---|---|---|
| `ci.yml` (read in full) | `push`/`pull_request` to `main`/`master` | Build + unit test + validate | `build` (checkout→npm ci→prisma generate→prisma validate→build→`test:ci`), `quality` (lint + `typecheck:strict`) | none — uses hardcoded dummy `DATABASE_URL`/`DIRECT_URL`/`SHADOW_DATABASE_URL` pointing at `localhost`, explicitly commented as "لا يفتح أي اتصال فعلي" (no real connection opened) | ❌ No | ❌ No |
| `security.yml` (read in full) | `push`/`pull_request` to `main`/`master`, plus weekly `schedule` (`0 3 * * 1`) | Secret scanning + dependency audit | `secrets` (gitleaks, blocking), `audit` (`npm audit --omit=dev --audit-level=high`, blocking; full audit report, non-blocking) | none | ❌ No | ❌ No |
| `prisma-production-deploy.yml` | `workflow_dispatch` only (per earlier same-day work in this project) | Manual, explicit production migration deploy using real Prisma CLI against Neon Production, secret-based, no `db push`/`reset`/`--accept-data-loss` | **content not re-read in this pass** — established and reviewed in this project's earlier turns; filename/purpose only re-confirmed here | `secrets.NEON_PRODUCTION_DATABASE_URL` (per earlier established review) | ✅ Yes (by design, gated behind manual dispatch) | ✅ Yes (applies `prisma migrate deploy` only) |
| `prisma-baseline-production-resolve.yml` | **NOT VERIFIED in this pass** (filename only) | Presumably a one-time baseline-resolve helper (`prisma migrate resolve`) | — | — | Presumed yes | Presumed yes (marking-only, not data-modifying) |
| `prisma-baseline.yml` | **NOT VERIFIED in this pass** (filename only) | Presumably baseline creation/testing helper | — | — | — | — |
| `dependency-audit-report.yml` | **NOT VERIFIED in this pass** (filename only) | Presumably a scheduled/report-only dependency audit | — | — | ❌ (report-only, inferred) | ❌ |
| `security-fix-apply.yml` | **NOT VERIFIED in this pass** (filename only) | Presumably an automated security-fix-application workflow | — | — | **NOT VERIFIED** | **NOT VERIFIED** |

**Whether production access exists and whether each workflow can modify the database** is marked "NOT VERIFIED" for the four workflows whose content was not re-read in this pass, rather than assumed safe or unsafe. This is a flagged follow-up item (Section 34).

---

## 31. Testing

- **Unit tests**: Jest (`jest ^29.7.0`, `ts-jest`), config in `jest.config.js`; run via `npm test` / `npm run test:ci` (CI) / `npm run test:cov` (coverage) / `npm run test:watch`.
- **E2E tests**: `npm run test:e2e` → `jest --config test/jest-e2e.json --runInBand`; a `test/` directory exists at repo root (confirmed present, contents not enumerated in this pass).
- **Logic tests**: `npm run test:logic` → `ts-node --transpile-only scripts/logic-test.ts` (a custom logic-test runner, 2,359 bytes — content not read).
- **Smoke tests**: `npm run smoke` → `scripts/smoke.mjs`.
- **Load tests**: `npm run load` → `scripts/load-test.mjs`.
- **CI-enforced checks**: unit tests (`test:ci`), Prisma schema validation (`prisma:validate`), build, ESLint (`lint:check`), strict type-check (`typecheck:strict`) — all confirmed as **blocking** CI jobs in `ci.yml`.
- **What is NOT confirmed tested**: actual test coverage/breadth (which modules/endpoints have tests, and which don't) was **NOT VERIFIED in this pass** — would require opening `test/` and every module's `*.spec.ts` files.

---

## 32. Dependencies

### Production dependencies (from `package.json`, verbatim versions)
`@aws-sdk/client-s3 ^3.637.0`, `@aws-sdk/s3-request-presigner ^3.637.0`, `@google-cloud/secret-manager ^5.6.0`, `@google-cloud/storage ^7.11.0`, `@nestjs/common ^10.3.8`, `@nestjs/config ^3.2.2`, `@nestjs/core ^10.3.8`, `@nestjs/jwt ^10.2.0`, `@nestjs/passport ^10.0.3`, `@nestjs/platform-express ^10.3.8`, `@nestjs/platform-socket.io ^10.3.8`, `@nestjs/schedule ^4.0.2`, `@nestjs/swagger ^7.4.2`, `@nestjs/throttler ^5.1.2`, `@nestjs/websockets ^10.3.8`, `@prisma/client ^5.15.0`, `@socket.io/redis-adapter ^8.3.0`, `bcryptjs ^2.4.3`, `class-transformer ^0.5.1`, `class-validator ^0.14.1`, `exceljs ^4.4.0`, `firebase-admin ^12.1.0`, `helmet ^7.1.0`, `ioredis ^5.4.1`, `passport ^0.7.0`, `passport-jwt ^4.0.1`, `pdfkit ^0.15.0`, `reflect-metadata ^0.2.2`, `rxjs ^7.8.1`, `socket.io ^4.7.5`, `swagger-ui-express ^5.0.1`.

### Dev dependencies
`@nestjs/cli ^10.3.2`, `@nestjs/schematics ^10.1.1`, `@nestjs/testing ^10.3.8`, `@types/*` (bcryptjs, express, jest, node, passport-jwt, pdfkit, supertest), `@typescript-eslint/eslint-plugin ^7.18.0`, `@typescript-eslint/parser ^7.18.0`, `eslint ^8.57.0`, `jest ^29.7.0`, `prisma ^5.15.0`, `supertest ^7.0.0`, `ts-jest ^29.1.5`, `ts-node ^10.9.2`, `typescript ^5.5.3`.

### Forced version overrides (security-motivated, per `package.json` `overrides`)
`js-yaml → 4.3.1`, `multer → 2.2.0`, `lodash → 4.18.0` — these pin transitive dependencies to specific (likely patched) versions; consistent with `SECURITY_FIX_REPORT.md` existing in the repo root (content not re-read in this pass).

### Engines
`node: >=20.15 <21`, `npm: >=10 <11`.

---

## 33. Environment Variables

Source: `.env.example` (full file read). **Names only — no values are real secrets in this file, and none are reproduced with values here.**

| Variable | Purpose (from comments) | Required? | Secret? |
|---|---|---|---|
| `NODE_ENV` | Environment mode | Yes | No |
| `PORT` | HTTP port | No (defaults 4000) | No |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | **Yes in production** (boot fails if empty or `*`) | No |
| `DATABASE_URL` | Postgres connection string | Yes | **Yes** |
| `REDIS_URL` | Redis connection string | Yes | **Yes** |
| `OSRM_BASE_URL` | Self-hosted routing engine base URL | No | No |
| `APP_ROLE` | `api` \| `worker` \| `all` | No (default `all`) | No |
| `AUTH_OTP_CHANNEL` | `firebase` \| `sms` | No | No |
| `OTP_DEV_MODE` | Dev-only OTP logging | No (ignored in prod) | No |
| `OTP_PEPPER` | OTP hashing pepper | Yes | **Yes** |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Firebase Admin bridge | No (feature disabled if empty) | **Yes** (`FIREBASE_PRIVATE_KEY`) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | JWT signing secrets | **Yes in production** (boot fails on weak/default values) | **Yes** |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Token TTLs | No | No |
| `COMPANY_COMMISSION` | Default platform commission % | No | No |
| `DEFAULT_COUNTRY_CODE` | Default phone country | No | No |
| `PRICING_EXPERIMENT_KEY` | Active pricing A/B experiment key | No | No |
| `FCM_SERVER_KEY` | Push notifications | No | **Yes** |
| `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER` | SMS provider | No | **Yes** (`SMS_API_KEY`) |
| `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM` | Email provider | No | **Yes** (`EMAIL_API_KEY`) |
| `GCP_PROJECT_ID` | GCP project | No | No |
| `R2_BUCKET`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` | Cloudflare R2 storage | First four required together to enable R2 | **Yes** (keys) |
| `GCS_BUCKET` | Legacy GCS storage | No | No |
| `USE_SECRET_MANAGER` | Enable Secret Manager boot-time fetch | No | No |
| `PAYMENT_WEBHOOK_TOKEN` | Payment webhook auth | **Yes in production** | **Yes** |
| `METRICS_TOKEN` | Protects `/api/metrics*` | **Yes in production** | **Yes** |
| `METRICS_MAX_SERIES` | Metrics cardinality cap | No | No |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_MAX_EVENTS_PER_MINUTE` | Sentry | No | **Yes** (`SENTRY_DSN`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_MAX_BATCH`, `OTEL_FLUSH_INTERVAL_MS`, `TRACING_ENABLED` | OpenTelemetry | No | **Yes** (`OTEL_EXPORTER_OTLP_HEADERS` may contain auth) |
| `ALERT_WEBHOOK_URL`, `ALERT_THROTTLE_MS` | Ops alerting | No | **Yes** (`ALERT_WEBHOOK_URL`) |
| `PUBLIC_SHARE_BASE_URL`, `PUBLIC_APP_URL` | Trip-share link base URLs | No | No |
| `SURGE_ENABLED`, `SURGE_THRESHOLD`, `SURGE_SENSITIVITY`, `SURGE_MAX_MULTIPLIER`, `SURGE_STEP`, `SURGE_MIN_DEMAND` | Dynamic surge pricing | No | No |
| `ROUTE_DEVIATION_ENABLED`, `ROUTE_DEVIATION_THRESHOLD_M` | Route-deviation detection | No | No |
| `CALL_MASKING_PROVIDER`, `DIRECT_CALL_REVEAL` | Call masking mode | No | No |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PROXY_NUMBERS`, `TWILIO_WEBHOOK_BASE_URL`, `TWILIO_DIAL_TIMEOUT_SEC`, `TWILIO_RECORD_CALLS` | Twilio voice masking | No (only if `CALL_MASKING_PROVIDER=twilio`) | **Yes** (`TWILIO_AUTH_TOKEN`) |
| `TRIP_TRACKING_RETENTION_MONTHS` | Tracking-partition retention window | No (default 3) | No |
| `LOYALTY_ENABLED`, `LOYALTY_POINTS_PER_UNIT`, `LOYALTY_REDEEM_POINTS_PER_UNIT`, `LOYALTY_MIN_REDEEM_POINTS`, `LOYALTY_REWARD_CURRENCY`, `LOYALTY_TIER_SILVER`, `LOYALTY_TIER_GOLD`, `LOYALTY_TIER_PLATINUM` | Loyalty config | No | No |
| `REFERRAL_ENABLED`, `REFERRAL_REFERRER_REWARD`, `REFERRAL_REFEREE_REWARD`, `REFERRAL_REWARD_CURRENCY` | Referral config | No | No |
| `TRIP_ARCHIVE_AFTER_MONTHS`, `TRIP_ARCHIVE_BATCH_SIZE`, `TRIP_ARCHIVE_ENABLED` | Trip archiving job config | No | No |
| `CHARGILY_SECRET_KEY`, `CHARGILY_MODE`, `CHARGILY_BASE_URL`, `CHARGILY_DEFAULT_METHOD`, `CHARGILY_WEBHOOK_URL`, `CHARGILY_SUCCESS_URL`, `CHARGILY_FAILURE_URL`, `CHARGILY_LOCALE` | Chargily payment gateway | No (feature disabled if key empty) | **Yes** (`CHARGILY_SECRET_KEY`) |
| `EMAIL_PROVIDER`, `EMAIL_REPLY_TO`, `EMAIL_TIMEOUT_MS`, `EMAIL_BRAND_NAME`, `EMAIL_BRAND_COLOR`, `EMAIL_BRAND_BACKGROUND`, `EMAIL_SUPPORT_ADDRESS`, `EMAIL_APP_URL` | Email branding/provider selection | No | No |
| `ENABLE_SWAGGER` | Enable Swagger UI in production | No | No |

**Render's actual configured environment variable names**: **NOT VERIFIED FROM RENDER** — no read tool exists in the current Render MCP connection to list env var names (only a write tool, `update_environment_variables`, exists, and it was correctly not used). All names above come from `.env.example` in the code, not from Render itself.

---

## 34. Known Risks / TODO / Technical Debt

| Item | Severity | Basis |
|---|---|---|
| Full per-controller API inventory not yet extracted into this document | MEDIUM | Explicitly out of scope for this pass (Sections 5–6); should be completed incrementally, module by module |
| `pricing-engine` and `profile-levels` module directories exist but have no confirmed `AppModule` import | MEDIUM | Section 4 — could be dead code, or legitimately consumed internally without root-level import; needs direct verification |
| Four GitHub Actions workflows (`prisma-baseline-production-resolve.yml`, `prisma-baseline.yml`, `dependency-audit-report.yml`, `security-fix-apply.yml`) not re-read for exact trigger/permission/production-access detail in this pass | MEDIUM | Section 30 |
| `prisma/seed.ts` idempotency not verified despite running on every Render production deploy | **HIGH** (if not idempotent, could cause deploy-time errors or duplicate data on every deploy) | Section 28 — this is the single highest-priority follow-up given it executes automatically in production |
| Loyalty field names in this request (`lifetimeTierPoints`/`tierPoints`/`rewardPoints`) do not match actual schema fields (`pointsBalance`/`lifetimePoints`) | LOW (naming/documentation clarity only) | Section 22 |
| `ensureUpcomingPartitions()`/`dropExpiredPartitions()` cron jobs referenced by name but not located in code in this pass | MEDIUM | Sections 11, 15 — operationally important for the partitioned `TripTracking` table's long-term health |
| Full schema-vs-Neon diff only performed for `TripTracking`, not all 90+ models | LOW–MEDIUM | Section 7 |
| Cloud Build/Cloud Run deployment path (`cloudbuild.yaml`, `Dockerfile`) coexists with the confirmed-live Render deployment; whether Cloud Run is also active is unknown | LOW (informational, unless it's an unmonitored duplicate production surface) | Section 1 |
| Historical markdown docs (`SERVER_STATUS_REPORT.md`, `UPGRADE_PLAN.md`, etc.) may be stale relative to this new baseline | INFORMATIONAL | Not re-verified against current code in this pass |

No risk is invented beyond what a gap in verification implies; severities reflect operational impact if the unverified item turns out to be a real problem, not a confirmed finding of a problem.

---

## 35. Current Production Snapshot — 2026-08-25

| Field | Value |
|---|---|
| GitHub main SHA | `647dc78065e702c21d496909a655e72ed4910d43` |
| Render deployed SHA | `647dc78065e702c21d496909a655e72ed4910d43` (matches GitHub main) |
| Neon migration | `20260825122500_trip_tracking_partitioning` (applied, `applied_steps_count=1`, `rolled_back_at=null`) |
| TripTracking rows | 51 |
| Driver count | 11 |
| Trip count | 96 |
| User count | 12 |
| Partitions | `TripTracking_202608`, `TripTracking_202609`, `TripTracking_202610`, `TripTracking_default` |
| Backend status | LIVE (Render deploy `dep-da6onvs9v7es73eick2g`, status `live`) |
| Health endpoint | `/api/health/live` (confirmed 200 responses in logs) |
| Build Command | `npm install --include=dev && npx prisma generate && npm run build && npx prisma migrate deploy && node dist/prisma/seed.js` |

---

## 36. Change History

### 2026-08-25
- PR #19 merged — `TripTracking` partitioning migration (`20260825122500_trip_tracking_partitioning`) added and tested.
- Production migration deployed to Neon Production; `TripTracking` converted to a partitioned table (4 partitions), integrity-checked before dropping the legacy table.
- PR #20 merged — added `.github/workflows/prisma-production-deploy.yml` (manual, `workflow_dispatch`-only, secret-based Prisma migration workflow).
- Render Build Command changed (manually, by the user) from a command containing `prisma db push --accept-data-loss` to one using `prisma migrate deploy`.
- Production verified via multiple READ-ONLY audits (Render settings/deploys/logs, Neon Production structure/data, GitHub state).
- FINAL READ-ONLY AUDIT completed — Backend marked **PRODUCTION READY**.
- This document (`BACKEND_MASTER_REFERENCE.md`) created as the initial baseline living reference, on branch `docs/backend-master-reference`.

---

## 37. Future Change Policy

### Rule 1
Any database change must go through an official Prisma migration.

### Rule 2
`prisma db push --accept-data-loss` is forbidden on Production.

### Rule 3
Every new migration must pass through: development/test → migration review → CI → merge → production deploy → verification.

### Rule 4
Any API change must update: the API inventory, affected modules, DTO documentation, and business-logic documentation in this file.

### Rule 5
Any new Table/Column/Enum/Index/Constraint must be added to this document.

### Rule 6
Any deletion must be documented in the Change History section.

### Rule 7
Any new Module must be added to the Module Inventory (Section 4).

### Rule 8
Any new External Service must be added to External Services (Section 18).

### Rule 9
Any new Environment Variable must be added to the Environment Variables section (Section 33) — name only, never its value.

### Rule 10
Any change to Render Build/Start/Runtime configuration must be documented (Section 29).

### Rule 11
Any change to GitHub Actions must be documented (Section 30).

### Rule 12
After every significant change, run an appropriate READ-ONLY audit and update this document.

---

## 38. Mandatory Document Update Rule

**BACKEND_MASTER_REFERENCE.md is a living source-of-truth document.**

Whenever the Backend is modified in the future:

1. Read `BACKEND_MASTER_REFERENCE.md` first.
2. Inspect the actual current state (do not rely on memory).
3. Implement the change.
4. Test the change.
5. Update `BACKEND_MASTER_REFERENCE.md` in the same change/PR.
6. Add a Change History entry.
7. Document: Added, Changed, Removed, Deprecated, Fixed, Database changes, API changes, Security changes, Configuration changes.
8. The task is **not** considered complete if the backend was modified but this document was not updated.

---

## 39. Document Version

See header at the top of this document for Document/Project/Repository/Document Type/Baseline Date/Last Verified/Baseline Commit/Production Status.

---

## 40. Final Quality Check (self-assessment for this baseline)

- ✅ Did not rely on `schema.prisma` alone for `TripTracking` — cross-checked against live Neon Production structure (from the same-day FINAL READ-ONLY AUDIT).
- ✅ Compared Render deployed commit against GitHub main HEAD (identical).
- ⚠️ Did **not** individually diff all 90+ schema models against Neon (only `TripTracking` + row-count spot checks) — flagged in Section 34.
- ⚠️ Did **not** read every controller/service/gateway file across 58 modules — flagged throughout as NOT VERIFIED rather than guessed.
- ✅ Read `package.json`, `.env.example`, `ci.yml`, `security.yml`, `app.module.ts`, `main.ts`, `schema.prisma`, and full root/`src`/`prisma`/`scripts`/`.github/workflows` directory listings directly.
- **No `SOURCE CONFLICT` was found between two authoritative sources that disagreed** in this pass. The `pricing-engine`/`profile-levels` module-import gap (Section 4) is an **unverified absence of evidence**, not a conflict between two sources that each asserted something — it is documented as such, not mislabeled as a conflict.

---

## 41–43. Document Creation, GitHub Workflow, Final Report

See the accompanying pull request for branch name, PR number, commit SHA, and file statistics. This file was added on a dedicated branch (`docs/backend-master-reference`), containing **only** this new file, with no other file modified. The PR is documentation-only, was not merged automatically, and no migration, deploy, or Production/Render/Neon change was performed as part of creating this document.
