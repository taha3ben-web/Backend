# جرد نقاط النهاية (Endpoints)

> مُولّد آليًا عبر `npm run docs:api` من `*.controller.ts`. لا تُحرّره يدويًا.

إجمالي المسارات: **437** عبر **46** وحدة.

كل المسارات متاحة تحت البادئة `/api` وأيضًا `/api/v1`.

## ads

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/ads` | Bearer | settings.manage |
| POST | `/api/ads` | Bearer | settings.manage |
| DELETE | `/api/ads/:id` | Bearer | settings.manage |
| PATCH | `/api/ads/:id` | Bearer | settings.manage |
| GET | `/api/ads/active` | Bearer | — |

## agents

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/agents` | Bearer | agents.manage, staff.manage |
| POST | `/api/agents` | Bearer | agents.manage, staff.manage |
| GET | `/api/agents/:id` | Bearer | agents.manage, staff.manage |
| PATCH | `/api/agents/:id` | Bearer | agents.manage, staff.manage |
| GET | `/api/agents/:id/audit` | Bearer | agents.manage, staff.manage |
| PATCH | `/api/agents/:id/password` | Bearer | agents.manage, staff.manage |
| PATCH | `/api/agents/:id/role` | Bearer | agents.manage, staff.manage |
| GET | `/api/agents/me/profile` | Bearer | — |
| GET | `/api/agents/options` | Bearer | agents.manage, staff.manage |

## app-versions

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/app-versions` | Bearer | settings.manage |
| POST | `/api/app-versions` | Bearer | settings.manage |
| DELETE | `/api/app-versions/:id` | Bearer | settings.manage |
| PATCH | `/api/app-versions/:id` | Bearer | settings.manage |
| GET | `/api/app-versions/check` | عام/آخر | — |

## assets

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/assets/file/:key` | عام/آخر | — |
| GET | `/api/assets/manifest` | عام/آخر | — |

## auth

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| POST | `/api/auth/firebase` | عام/آخر | — |
| POST | `/api/auth/login` | عام/آخر | — |
| POST | `/api/auth/logout` | Bearer | — |
| POST | `/api/auth/me` | Bearer | — |
| POST | `/api/auth/otp/request` | عام/آخر | — |
| POST | `/api/auth/otp/verify` | عام/آخر | — |
| POST | `/api/auth/refresh` | عام/آخر | — |
| POST | `/api/auth/register` | عام/آخر | — |

## backups

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/backups` | Bearer | settings.manage |
| POST | `/api/backups` | Bearer | settings.manage |
| DELETE | `/api/backups/:id` | Bearer | settings.manage |
| GET | `/api/backups/:id` | Bearer | settings.manage |
| PATCH | `/api/backups/:id` | Bearer | settings.manage |
| GET | `/api/backups/dr-status` | Bearer | settings.manage |
| POST | `/api/backups/retention/apply` | Bearer | settings.manage |

## bootstrap

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/admin/bootstrap/preview` | Bearer | settings.manage |
| GET | `/api/bootstrap` | Bearer | — |

## city-scaling

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/cities/scaling` | Bearer | settings.manage |
| POST | `/api/cities/scaling` | Bearer | settings.manage |
| GET | `/api/cities/scaling/:cityId` | Bearer | settings.manage |
| GET | `/api/cities/scaling/:cityId/acceptance` | Bearer | settings.manage |
| PATCH | `/api/cities/scaling/:cityId/launch-status` | Bearer | settings.manage |

## content-blocks

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/content-blocks` | Bearer | settings.manage |
| POST | `/api/content-blocks` | Bearer | settings.manage |
| DELETE | `/api/content-blocks/:id` | Bearer | settings.manage |
| GET | `/api/content-blocks/:id` | Bearer | settings.manage |
| PATCH | `/api/content-blocks/:id` | Bearer | settings.manage |
| GET | `/api/content-blocks/live` | Bearer | — |

## country-config

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/country-config` | Bearer | settings.manage |
| GET | `/api/country-config/:code` | Bearer | settings.manage |
| PUT | `/api/country-config/:code` | Bearer | settings.manage |
| GET | `/api/country-config/:code/phone` | Bearer | settings.manage |
| GET | `/api/country-config/:code/tax` | Bearer | settings.manage |

## coupons

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/coupons` | Bearer | coupons.manage |
| POST | `/api/coupons` | Bearer | coupons.manage |
| DELETE | `/api/coupons/:id` | Bearer | coupons.manage |
| GET | `/api/coupons/:id` | Bearer | coupons.manage |
| PATCH | `/api/coupons/:id` | Bearer | coupons.manage |
| POST | `/api/coupons/validate` | Bearer | — |

## dashboard

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/dashboard/earnings` | Bearer | reports.read, payments.read |
| GET | `/api/dashboard/latest` | Bearer | reports.read, trips.read, support.manage |
| GET | `/api/dashboard/live-map` | Bearer | reports.read, drivers.read |
| GET | `/api/dashboard/operations` | Bearer | reports.read, support.manage, safety.manage |
| GET | `/api/dashboard/ops/dead-letters` | Bearer | reports.read |
| POST | `/api/dashboard/ops/dead-letters/:id/retry` | Bearer | payments.manage |
| GET | `/api/dashboard/ops/incidents` | Bearer | reports.read |
| POST | `/api/dashboard/ops/incidents/:id/resolve` | Bearer | payments.manage |
| GET | `/api/dashboard/ops/overview` | Bearer | reports.read |
| POST | `/api/dashboard/ops/reconciliation/run` | Bearer | payments.manage |
| GET | `/api/dashboard/ops/risk-reviews` | Bearer | reports.read |
| GET | `/api/dashboard/ops/settlements` | Bearer | payments.read |
| POST | `/api/dashboard/ops/settlements/retry` | Bearer | payments.manage |
| GET | `/api/dashboard/readiness` | Bearer | audit.read, reports.read, staff.manage |
| GET | `/api/dashboard/summary` | Bearer | reports.read, drivers.read, trips.read |

## drivers

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/documents` | Bearer | drivers.documents, drivers.manage |
| PATCH | `/api/documents/:id/review` | Bearer | drivers.documents, drivers.manage |
| GET | `/api/driver-qr/resolve/:publicIdentifier` | عام/آخر | — |
| GET | `/api/driver/me` | Bearer | — |
| PATCH | `/api/driver/me` | Bearer | — |
| POST | `/api/driver/me/availability` | Bearer | — |
| POST | `/api/driver/me/documents` | Bearer | — |
| GET | `/api/driver/me/earnings` | Bearer | — |
| GET | `/api/driver/me/sanctions` | Bearer | — |
| GET | `/api/driver/me/trips` | Bearer | — |
| GET | `/api/driver/me/trips/:id` | Bearer | — |
| PATCH | `/api/driver/me/trips/:id/status` | Bearer | — |
| POST | `/api/driver/me/upload-url` | Bearer | — |
| GET | `/api/drivers` | Bearer | drivers.read, drivers.manage |
| GET | `/api/drivers/:driverId/qr` | Bearer | qr.read, qr.manage |
| POST | `/api/drivers/:driverId/qr/issue` | Bearer | qr.read, qr.manage |
| POST | `/api/drivers/:driverId/qr/revoke` | Bearer | qr.read, qr.manage |
| POST | `/api/drivers/:driverId/qr/rotate` | Bearer | qr.read, qr.manage |
| GET | `/api/drivers/:id` | Bearer | drivers.read, drivers.manage |
| PATCH | `/api/drivers/:id/approve` | Bearer | drivers.manage |
| PATCH | `/api/drivers/:id/ban` | Bearer | drivers.manage |
| PATCH | `/api/drivers/:id/reject` | Bearer | drivers.manage |
| PATCH | `/api/drivers/:id/suspend` | Bearer | drivers.manage |
| PATCH | `/api/drivers/documents/:docId/review` | Bearer | drivers.documents, drivers.manage |
| PATCH | `/api/drivers/sanctions/:id/lift` | Bearer | drivers.manage |
| GET | `/api/drivers/sanctions/config` | Bearer | drivers.read, drivers.manage |
| GET | `/api/drivers/sanctions/log` | Bearer | drivers.read, drivers.manage |
| GET | `/api/drivers/sanctions/suspended` | Bearer | drivers.read, drivers.manage |
| GET | `/api/vehicles` | Bearer | drivers.read, drivers.manage |
| PATCH | `/api/vehicles/:id/toggle` | Bearer | drivers.manage |
| PATCH | `/api/vehicles/:id/verify` | Bearer | drivers.manage |

## emergency

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| POST | `/api/emergency-contacts` | Bearer | — |
| DELETE | `/api/emergency-contacts/:id` | Bearer | — |
| PATCH | `/api/emergency-contacts/:id` | Bearer | — |
| GET | `/api/emergency-contacts/me` | Bearer | — |
| GET | `/api/emergency-contacts/user/:userId` | Bearer | safety.manage, support.manage |
| GET | `/api/safety/incidents` | Bearer | safety.manage |
| POST | `/api/safety/incidents` | Bearer | — |
| PATCH | `/api/safety/incidents/:id/status` | Bearer | safety.manage |
| GET | `/api/safety/incidents/me` | Bearer | — |

## fare-quotes

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/admin/fare-offers` | Bearer | pricing.manage |
| GET | `/api/admin/fare-offers/:id` | Bearer | pricing.manage |
| GET | `/api/admin/fare-quotes` | Bearer | pricing.manage |
| GET | `/api/admin/fare-quotes/:id` | Bearer | pricing.manage |
| POST | `/api/admin/fare-quotes/simulate` | Bearer | pricing.manage |
| GET | `/api/driver/fare-offers` | Bearer | — |
| POST | `/api/driver/fare-offers` | Bearer | — |
| POST | `/api/driver/fare-offers/:id/withdraw` | Bearer | — |
| GET | `/api/fare-quotes` | Bearer | — |
| POST | `/api/fare-quotes` | Bearer | — |
| GET | `/api/fare-quotes/:id` | Bearer | — |
| POST | `/api/fare-quotes/:id/cancel` | Bearer | — |
| GET | `/api/fare-quotes/:id/offers` | Bearer | — |
| POST | `/api/fare-quotes/:id/offers/:offerId/accept` | Bearer | — |
| POST | `/api/fare-quotes/:id/offers/:offerId/reject` | Bearer | — |
| POST | `/api/fare-quotes/:id/propose` | Bearer | — |

## financial

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/financial/accounts` | Bearer | payments.read, reports.read |
| GET | `/api/financial/reconciliation/incidents` | Bearer | payments.read, reports.read |
| POST | `/api/financial/reconciliation/incidents/resolve` | Bearer | payments.manage |
| GET | `/api/financial/reconciliation/items` | Bearer | payments.read, reports.read |
| POST | `/api/financial/reconciliation/run` | Bearer | payments.manage |
| GET | `/api/financial/reconciliation/summary` | Bearer | payments.read, reports.read |
| GET | `/api/financial/settlement/queue` | Bearer | payments.read, payments.manage |
| POST | `/api/financial/settlement/run` | Bearer | payments.manage |
| GET | `/api/financial/transactions` | Bearer | payments.read, reports.read |

## geo

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/admin/geo/provider` | Bearer | settings.manage |
| PUT | `/api/admin/geo/provider` | Bearer | settings.manage |
| GET | `/api/geo/autocomplete` | Bearer | — |
| POST | `/api/geo/directions` | Bearer | — |
| GET | `/api/geo/geocode` | Bearer | — |
| GET | `/api/geo/places` | Bearer | — |
| POST | `/api/geo/places` | Bearer | — |
| DELETE | `/api/geo/places/:id` | Bearer | — |
| PATCH | `/api/geo/places/:id` | Bearer | — |
| POST | `/api/geo/places/recent` | Bearer | — |
| GET | `/api/geo/reverse` | Bearer | — |
| GET | `/api/geofence/resolve` | Bearer | settings.manage, pricing.manage |
| GET | `/api/geofence/serviceable` | Bearer | — |

## growth

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/growth/experiments` | Bearer | — |
| POST | `/api/growth/experiments` | Bearer | — |
| GET | `/api/growth/experiments/:key/assignment` | Bearer | — |
| GET | `/api/growth/incentives` | Bearer | — |
| POST | `/api/growth/incentives` | Bearer | — |
| POST | `/api/growth/incentives/:id/progress` | Bearer | — |

## health

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/health` | عام/آخر | — |
| GET | `/api/health/live` | عام/آخر | — |
| GET | `/api/health/ready` | عام/آخر | — |

## kyc

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/kyc` | Bearer | kyc.manage |
| GET | `/api/kyc/:id` | Bearer | kyc.manage |
| POST | `/api/kyc/:id/approve` | Bearer | kyc.manage |
| POST | `/api/kyc/:id/reject` | Bearer | kyc.manage |
| GET | `/api/kyc/me` | Bearer | — |
| POST | `/api/kyc/submit` | Bearer | — |

## legal

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/legal-documents` | Bearer | settings.manage |
| POST | `/api/legal-documents` | Bearer | settings.manage |
| GET | `/api/legal-documents/:id` | Bearer | settings.manage |
| PATCH | `/api/legal-documents/:id` | Bearer | settings.manage |
| POST | `/api/legal-documents/:id/accept` | Bearer | — |
| POST | `/api/legal-documents/:id/publish` | Bearer | settings.manage |
| GET | `/api/legal-documents/:id/versions` | Bearer | settings.manage |
| GET | `/api/legal-documents/pending` | Bearer | — |
| GET | `/api/public/legal` | عام/آخر | — |

## loyalty

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/loyalty` | Bearer | loyalty.manage |
| POST | `/api/loyalty/:userId/adjust` | Bearer | loyalty.manage |
| GET | `/api/loyalty/me` | Bearer | — |
| GET | `/api/loyalty/me/history` | Bearer | — |
| POST | `/api/loyalty/redeem` | Bearer | — |

## matching

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/rides/:id` | Bearer | — |
| PATCH | `/api/rides/:id/cancel` | Bearer | — |
| GET | `/api/rides/mine` | Bearer | — |
| POST | `/api/rides/quote` | Bearer | — |
| POST | `/api/rides/request` | Bearer | — |

## message-templates

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/message-templates` | Bearer | notifications.send |
| POST | `/api/message-templates` | Bearer | notifications.send |
| DELETE | `/api/message-templates/:id` | Bearer | notifications.send |
| GET | `/api/message-templates/:id` | Bearer | notifications.send |
| PATCH | `/api/message-templates/:id` | Bearer | notifications.send |
| POST | `/api/message-templates/preview` | Bearer | notifications.send |
| POST | `/api/message-templates/render/:key` | Bearer | notifications.send |

## metrics

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/metrics` | عام/آخر | — |
| GET | `/api/metrics/prometheus` | عام/آخر | — |

## notifications

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/notifications` | Bearer | notifications.send |
| POST | `/api/notifications` | Bearer | notifications.send |
| DELETE | `/api/notifications/:id` | Bearer | notifications.send |
| POST | `/api/notifications/devices` | Bearer | — |
| DELETE | `/api/notifications/devices/:token` | Bearer | — |
| GET | `/api/notifications/me` | Bearer | — |

## payment-gateways

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/dashboard/payments/gateways/providers` | Bearer | payments.read, payments.manage |
| GET | `/api/dashboard/payments/gateways/recent-events` | Bearer | payments.read, payments.manage |
| GET | `/api/dashboard/payments/gateways/webhook-health` | Bearer | payments.read, payments.manage |

## payments

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/driver-funding/requests` | Bearer | funding.read, funding.manage |
| POST | `/api/driver-funding/requests` | Bearer | funding.manage |
| GET | `/api/driver-funding/requests/:id` | Bearer | funding.read, funding.manage |
| PATCH | `/api/driver-funding/requests/:id/approve` | Bearer | funding.manage |
| POST | `/api/driver-funding/requests/:id/fund` | Bearer | funding.manage |
| PATCH | `/api/driver-funding/requests/:id/reject` | Bearer | funding.manage |
| GET | `/api/driver-transfers` | Bearer | transfer.read, transfer.manage |
| POST | `/api/driver-transfers` | Bearer | transfer.manage |
| GET | `/api/driver-transfers/:id` | Bearer | transfer.read, transfer.manage |
| PATCH | `/api/driver-transfers/:id/approve` | Bearer | transfer.manage |
| POST | `/api/driver-transfers/:id/complete` | Bearer | transfer.manage |
| PATCH | `/api/driver-transfers/:id/reject` | Bearer | transfer.manage |
| GET | `/api/payments` | Bearer | payments.read, payments.manage |
| GET | `/api/payments/:id` | Bearer | payments.read, payments.manage |
| POST | `/api/payments/:id/cancel` | Bearer | payments.manage |
| POST | `/api/payments/:id/capture` | Bearer | payments.manage |
| POST | `/api/payments/:id/refund` | Bearer | payments.manage |
| PATCH | `/api/payments/:id/status` | Bearer | payments.manage |
| GET | `/api/payments/refunds` | Bearer | payments.read, payments.manage |
| GET | `/api/payments/summary` | Bearer | payments.read, payments.manage |
| POST | `/api/payments/trip/:tripId/checkout` | Bearer | payments.manage |
| POST | `/api/payments/webhooks/:provider` | عام/آخر | — |
| GET | `/api/wallet/me` | Bearer | — |
| GET | `/api/withdrawals` | Bearer | payments.read, payments.manage |
| POST | `/api/withdrawals` | Bearer | — |
| PATCH | `/api/withdrawals/:id/approve` | Bearer | payments.manage |
| PATCH | `/api/withdrawals/:id/paid` | Bearer | payments.manage |
| PATCH | `/api/withdrawals/:id/reject` | Bearer | payments.manage |
| GET | `/api/withdrawals/payout-integrity` | Bearer | payments.read, payments.manage |
| GET | `/api/withdrawals/settlement-proposal` | Bearer | payments.read, payments.manage |
| GET | `/api/withdrawals/summary` | Bearer | payments.read, payments.manage |

## payouts

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/payments/payouts` | Bearer | — |
| POST | `/api/payments/payouts` | Bearer | — |
| GET | `/api/payments/payouts/:id` | Bearer | — |
| PATCH | `/api/payments/payouts/:id/status` | Bearer | — |

## pooling

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/pooling/candidates/:tripId` | Bearer | trips.read, trips.manage |

## pricing

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| POST | `/api/pricing/peak` | Bearer | pricing.manage |
| DELETE | `/api/pricing/peak/:id` | Bearer | pricing.manage |
| GET | `/api/pricing/rules` | Bearer | pricing.manage |
| POST | `/api/pricing/rules` | Bearer | pricing.manage |
| DELETE | `/api/pricing/rules/:id` | Bearer | pricing.manage |
| PATCH | `/api/pricing/rules/:id` | Bearer | pricing.manage |

## pricing-engine

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| POST | `/api/pricing-engine/quote` | Bearer | pricing.manage |

## promo-codes

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/promo-codes` | Bearer | promoCodes.manage |
| POST | `/api/promo-codes` | Bearer | promoCodes.manage |
| DELETE | `/api/promo-codes/:id` | Bearer | promoCodes.manage |
| GET | `/api/promo-codes/:id` | Bearer | promoCodes.manage |
| PATCH | `/api/promo-codes/:id` | Bearer | promoCodes.manage |
| POST | `/api/promo-codes/redeem` | Bearer | — |

## queue-insight

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/dashboard/queue/backlog-by-name` | Bearer | reports.read |
| GET | `/api/dashboard/queue/dead-letters` | Bearer | reports.read |
| POST | `/api/dashboard/queue/dead-letters/retry-all` | Bearer | payments.manage |
| GET | `/api/dashboard/queue/insight` | Bearer | reports.read |
| POST | `/api/dashboard/queue/purge-delivered` | Bearer | settings.manage |

## rbac

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/logs/activity` | Bearer | audit.read, staff.manage |
| GET | `/api/logs/audit` | Bearer | audit.read, staff.manage |
| GET | `/api/rbac/permissions` | Bearer | staff.manage |
| POST | `/api/rbac/permissions` | Bearer | staff.manage |
| GET | `/api/rbac/roles` | Bearer | staff.manage |
| POST | `/api/rbac/roles` | Bearer | staff.manage |
| DELETE | `/api/rbac/roles/:id` | Bearer | staff.manage |
| GET | `/api/rbac/roles/:id` | Bearer | staff.manage |
| PATCH | `/api/rbac/roles/:id` | Bearer | staff.manage |
| PUT | `/api/rbac/roles/:id/permissions` | Bearer | staff.manage |
| GET | `/api/staff` | Bearer | staff.manage |
| POST | `/api/staff` | Bearer | staff.manage |
| PATCH | `/api/staff/:id/password` | Bearer | staff.manage |
| PATCH | `/api/staff/:id/role` | Bearer | staff.manage |
| PATCH | `/api/staff/:id/status` | Bearer | staff.manage |

## referral

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/referrals` | Bearer | referrals.manage |
| POST | `/api/referrals/:refereeId/qualify` | Bearer | referrals.manage |
| POST | `/api/referrals/apply` | Bearer | — |
| GET | `/api/referrals/mine` | Bearer | — |
| GET | `/api/referrals/my-code` | Bearer | — |

## reports

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/reports/:type` | Bearer | reports.read |
| GET | `/api/statistics/financial-health` | Bearer | reports.read, payments.read |
| GET | `/api/statistics/funding-ops` | Bearer | reports.read, funding.read |
| GET | `/api/statistics/overview` | Bearer | reports.read |
| GET | `/api/statistics/payment-ops` | Bearer | reports.read, payments.read |
| GET | `/api/statistics/revenue` | Bearer | reports.read |
| GET | `/api/statistics/settlement-ops` | Bearer | reports.read, payments.read |
| GET | `/api/statistics/timeseries` | Bearer | reports.read |
| GET | `/api/statistics/top-cities` | Bearer | reports.read |
| GET | `/api/statistics/top-drivers` | Bearer | reports.read |
| GET | `/api/statistics/transfer-ops` | Bearer | reports.read, transfer.read |
| GET | `/api/statistics/withdrawal-ops` | Bearer | reports.read, payments.read |

## risk

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| DELETE | `/api/risk/blacklist` | Bearer | risk.manage |
| GET | `/api/risk/blacklist` | Bearer | risk.manage |
| POST | `/api/risk/blacklist` | Bearer | risk.manage |
| GET | `/api/risk/events` | Bearer | risk.review |
| GET | `/api/risk/fraud-signals` | Bearer | risk.review |
| GET | `/api/risk/holds` | Bearer | risk.manage |
| POST | `/api/risk/holds` | Bearer | risk.manage |
| POST | `/api/risk/holds/:id/release` | Bearer | risk.manage |
| GET | `/api/risk/reviews` | Bearer | risk.review |
| POST | `/api/risk/reviews/:id/resolve` | Bearer | risk.review |

## scheduled-trips

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/trips/scheduled` | Bearer | — |
| POST | `/api/trips/scheduled` | Bearer | — |
| DELETE | `/api/trips/scheduled/:id` | Bearer | — |
| GET | `/api/trips/scheduled/mine` | Bearer | — |

## sessions

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| DELETE | `/api/sessions` | Bearer | — |
| DELETE | `/api/sessions/:id` | Bearer | — |
| GET | `/api/sessions/me` | Bearer | — |
| DELETE | `/api/sessions/user/:userId` | Bearer | audit.read, staff.manage |
| GET | `/api/sessions/user/:userId` | Bearer | audit.read, staff.manage |
| DELETE | `/api/sessions/user/:userId/:id` | Bearer | audit.read, staff.manage |

## settings

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/cities` | Bearer | settings.manage |
| POST | `/api/cities` | Bearer | settings.manage |
| DELETE | `/api/cities/:id` | Bearer | settings.manage |
| GET | `/api/cities/:id` | Bearer | settings.manage |
| PATCH | `/api/cities/:id` | Bearer | settings.manage |
| GET | `/api/feature-flags` | Bearer | settings.manage |
| POST | `/api/feature-flags` | Bearer | settings.manage |
| DELETE | `/api/feature-flags/:id` | Bearer | settings.manage |
| PATCH | `/api/feature-flags/:id` | Bearer | settings.manage |
| GET | `/api/feature-flags/control` | Bearer | settings.manage |
| PATCH | `/api/feature-flags/control` | Bearer | settings.manage |
| GET | `/api/feature-flags/health` | Bearer | settings.manage |
| POST | `/api/feature-flags/preview` | Bearer | settings.manage |
| GET | `/api/setting-change-requests` | Bearer | settings.manage |
| POST | `/api/setting-change-requests/:id/approve` | Bearer | settings.manage |
| POST | `/api/setting-change-requests/:id/reject` | Bearer | settings.manage |
| GET | `/api/settings` | Bearer | settings.manage |
| POST | `/api/settings` | Bearer | settings.manage |
| DELETE | `/api/settings/:key` | Bearer | settings.manage |
| GET | `/api/settings/:key` | Bearer | settings.manage |
| PUT | `/api/settings/:key` | Bearer | settings.manage |
| POST | `/api/settings/:key/discard-draft` | Bearer | settings.manage |
| POST | `/api/settings/:key/publish` | Bearer | settings.manage |
| GET | `/api/settings/:key/revisions` | Bearer | settings.manage |
| POST | `/api/settings/:key/rollback/:publishedVersion` | Bearer | settings.manage |
| POST | `/api/settings/bulk` | Bearer | settings.manage |
| GET | `/api/settings/governance/overview` | Bearer | settings.manage |
| GET | `/api/zones` | Bearer | settings.manage |
| POST | `/api/zones` | Bearer | settings.manage |
| DELETE | `/api/zones/:id` | Bearer | settings.manage |
| GET | `/api/zones/:id` | Bearer | settings.manage |
| PATCH | `/api/zones/:id` | Bearer | settings.manage |

## subscriptions

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/subscriptions` | Bearer | subscriptions.manage |
| POST | `/api/subscriptions/cancel` | Bearer | — |
| GET | `/api/subscriptions/me` | Bearer | — |
| GET | `/api/subscriptions/plans` | Bearer | — |
| POST | `/api/subscriptions/plans` | Bearer | subscriptions.manage |
| DELETE | `/api/subscriptions/plans/:id` | Bearer | subscriptions.manage |
| PATCH | `/api/subscriptions/plans/:id` | Bearer | subscriptions.manage |
| GET | `/api/subscriptions/plans/all` | Bearer | subscriptions.manage |
| POST | `/api/subscriptions/subscribe` | Bearer | — |

## support

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/ratings` | Bearer | support.manage |
| POST | `/api/ratings` | Bearer | — |
| GET | `/api/ratings/user/:userId` | Bearer | — |
| GET | `/api/support/complaints` | Bearer | support.manage, safety.manage |
| POST | `/api/support/complaints` | Bearer | — |
| GET | `/api/support/complaints/:id` | Bearer | support.manage, safety.manage |
| PATCH | `/api/support/complaints/:id/status` | Bearer | support.manage, safety.manage |
| GET | `/api/support/tickets` | Bearer | support.manage |
| POST | `/api/support/tickets` | Bearer | — |
| GET | `/api/support/tickets/:id` | Bearer | — |
| PATCH | `/api/support/tickets/:id/assign` | Bearer | — |
| POST | `/api/support/tickets/:id/first-response` | Bearer | — |
| POST | `/api/support/tickets/:id/messages` | Bearer | — |
| PATCH | `/api/support/tickets/:id/priority` | Bearer | — |
| PATCH | `/api/support/tickets/:id/resolve` | Bearer | — |
| PATCH | `/api/support/tickets/:id/status` | Bearer | support.manage |
| GET | `/api/support/tickets/breaching` | Bearer | — |
| GET | `/api/support/tickets/me` | Bearer | — |

## trips

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| POST | `/api/driver/trips/:id/arriving` | Bearer | — |
| POST | `/api/driver/trips/:id/cancel` | Bearer | — |
| POST | `/api/driver/trips/:id/complete` | Bearer | — |
| POST | `/api/driver/trips/:id/start` | Bearer | — |
| GET | `/api/driver/trips/:id/track` | Bearer | — |
| GET | `/api/trips` | Bearer | trips.read, trips.manage |
| GET | `/api/trips/:id` | Bearer | trips.read, trips.manage |
| POST | `/api/trips/:id/retry-settlement` | Bearer | trips.manage, payments.manage |
| PATCH | `/api/trips/:id/status` | Bearer | trips.manage |
| GET | `/api/trips/dispatch-metrics` | Bearer | trips.read, reports.read |

## users

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/passenger/me` | Bearer | — |
| PATCH | `/api/passenger/me` | Bearer | — |
| POST | `/api/passenger/me/upload-url` | Bearer | — |
| GET | `/api/passengers` | Bearer | passengers.read, passengers.manage |
| GET | `/api/passengers/:id` | Bearer | passengers.read, passengers.manage |
| PATCH | `/api/passengers/:id/activate` | Bearer | passengers.manage |
| PATCH | `/api/passengers/:id/ban` | Bearer | passengers.manage |
| GET | `/api/passengers/:id/overview` | Bearer | passengers.read, passengers.manage |
| PATCH | `/api/passengers/:id/suspend` | Bearer | passengers.manage |
| GET | `/api/passengers/:id/trips` | Bearer | passengers.read, passengers.manage |

## vehicle-types

| الطريقة | المسار | الحماية | الصلاحيات |
|---|---|---|---|
| GET | `/api/catalog/analytics` | Bearer | pricing.manage, reports.read |
| GET | `/api/catalog/audit` | Bearer | pricing.manage, audit.read |
| GET | `/api/catalog/vehicles` | Bearer | — |
| GET | `/api/catalog/version` | Bearer | — |
| GET | `/api/features` | Bearer | pricing.manage, settings.manage |
| POST | `/api/features` | Bearer | pricing.manage, settings.manage |
| DELETE | `/api/features/:id` | Bearer | pricing.manage, settings.manage |
| GET | `/api/features/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/features/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/features/:id/active` | Bearer | pricing.manage, settings.manage |
| POST | `/api/features/:id/restore` | Bearer | pricing.manage, settings.manage |
| GET | `/api/service-areas` | Bearer | pricing.manage, settings.manage |
| POST | `/api/service-areas` | Bearer | pricing.manage, settings.manage |
| DELETE | `/api/service-areas/:id` | Bearer | pricing.manage, settings.manage |
| GET | `/api/service-areas/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/service-areas/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/service-areas/:id/active` | Bearer | pricing.manage, settings.manage |
| POST | `/api/service-areas/:id/restore` | Bearer | pricing.manage, settings.manage |
| GET | `/api/vehicle-categories` | Bearer | pricing.manage, settings.manage |
| POST | `/api/vehicle-categories` | Bearer | pricing.manage, settings.manage |
| DELETE | `/api/vehicle-categories/:id` | Bearer | pricing.manage, settings.manage |
| GET | `/api/vehicle-categories/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-categories/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-categories/:id/active` | Bearer | pricing.manage, settings.manage |
| POST | `/api/vehicle-categories/:id/restore` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-categories/:id/status` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-categories/reorder` | Bearer | pricing.manage, settings.manage |
| GET | `/api/vehicle-pricing` | Bearer | pricing.manage |
| POST | `/api/vehicle-pricing` | Bearer | pricing.manage |
| DELETE | `/api/vehicle-pricing/:id` | Bearer | pricing.manage |
| GET | `/api/vehicle-pricing/:id` | Bearer | pricing.manage |
| PATCH | `/api/vehicle-pricing/:id` | Bearer | pricing.manage |
| POST | `/api/vehicle-pricing/:id/restore` | Bearer | pricing.manage |
| GET | `/api/vehicle-types` | Bearer | pricing.manage, settings.manage |
| POST | `/api/vehicle-types` | Bearer | pricing.manage, settings.manage |
| DELETE | `/api/vehicle-types/:id` | Bearer | pricing.manage, settings.manage |
| GET | `/api/vehicle-types/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-types/:id` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-types/:id/active` | Bearer | pricing.manage, settings.manage |
| GET | `/api/vehicle-types/:id/fields` | Bearer | pricing.manage, settings.manage |
| POST | `/api/vehicle-types/:id/fields` | Bearer | pricing.manage, settings.manage |
| POST | `/api/vehicle-types/:id/restore` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-types/:id/status` | Bearer | pricing.manage, settings.manage |
| GET | `/api/vehicle-types/:id/verify/:driverId` | Bearer | pricing.manage, settings.manage |
| DELETE | `/api/vehicle-types/fields/:fieldId` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-types/fields/:fieldId` | Bearer | pricing.manage, settings.manage |
| PATCH | `/api/vehicle-types/reorder` | Bearer | pricing.manage, settings.manage |

