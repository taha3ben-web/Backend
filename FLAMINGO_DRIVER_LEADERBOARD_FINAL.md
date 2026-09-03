# FLAMINGO — DRIVER LEADERBOARD ENGINE — FINAL REPORT

Branch: `feature/driver-leaderboard` · PR: #24 (open, **not merged**)
Head commit at report time: `5f088dbf40cb7334a78986996b267811b58e70bb`
Base: `main` @ `fade48ec690a28f161ed8ea047839bb76f101245`

## 1. Executive summary

The driver leaderboard was already published, but it was computed inside
`driver-self.service.ts` as "score = number of completed trips", by loading up
to 1000 approved drivers and sorting them in Node.js. That design could not
scale, could not express any business rule without a code deploy, could not
return a correct rank outside the loaded window, and mixed the Arabic unit label
into the API payload.

This change replaces the computation — not the product — with a
dashboard-configurable scoring engine that ranks in PostgreSQL with window
functions, keeps the published API backward compatible, and ships defaults that
reproduce today's numbers exactly. **No new Prisma model, no migration.**

## 2. Current state before the change (VERIFIED in code)

- `GET /api/driver/me/leaderboard` -> `DriverSelfService.leaderboard()`.
- `driver.findMany({ where: { status: "APPROVED", ...localFilter }, take: 1000 })`
  plus `trip.groupBy({ by: ["driverId"], where: { status: "COMPLETED" } })`,
  then `.sort()` in Node.
- Response `{ scope, localBasis, period: "ALL_TIME", available, total, rows, me }`,
  row `{ rank, driverId, name, photoUrl, cityName, score, scoreUnit: "رحلة", rating, isMe }`.
- No `Leaderboard`, `Ranking`, `LeaderboardScore`, `DriverLoyaltyTier`,
  `tierPoints`, `rewardPoints` or `lifetimeTierPoints` model exists.
- Profile levels (`BRONZE..LEGENDARY`), growth incentives, loyalty/reward points
  and financial settlement are separate systems and were left untouched.

## 3. What was implemented

New files:

- `src/modules/drivers/leaderboard.util.ts` — pure rules/score/ranking layer.
- `src/modules/drivers/leaderboard.service.ts` — SQL ranking, cache, decoration.
- `src/modules/drivers/leaderboard-admin.controller.ts` — read-only config/preview.
- `src/modules/drivers/leaderboard.util.spec.ts` — unit tests.
- `docs/driver-leaderboard.md` — engine documentation.

Edited files:

- `src/modules/drivers/driver-self.service.ts` — legacy method now delegates.
- `src/modules/drivers/driver-self.controller.ts` — added summary endpoint.
- `src/modules/drivers/drivers.module.ts` — wiring.

Behavior, configuration surface, eligibility, scope handling, determinism,
performance, caching, security and i18n are documented in
`docs/driver-leaderboard.md`.

## 4. Deliberately NOT implemented

- No fourth points system: leaderboard score, profile level, incentives,
  loyalty/reward points and financial ledger stay separate. Gold remains a
  profile level, never a leaderboard rank.
- No acceptance-rate or streak rules (no trustworthy stored source).
- No new tables, no rule-engine framework, no configuration-version history
  table: the existing settings revisions + `AuditLog` already answer "who
  changed which rule and when". Full historical score replay (frozen past
  periods) is **not** implemented; see risks.
- No settlement-based score gating (see the logged unrelated defect below).

## 5. Database

- Prisma schema: **unchanged**.
- Migrations: **none added**. `prisma/migrations/0_init` and
  `prisma/migrations_archive` untouched. No `db push`, no `migrate reset`, no
  destructive command, nothing run against production.

## 6. Verification (honest)

| Check | Status |
| --- | --- |
| `prettier --check` (changed files) | VERIFIED — executed locally |
| UTF-8 integrity of changed files | VERIFIED — executed locally (0 replacement chars) |
| `npm ci` | BLOCKED — no network / no `node_modules` in the sandbox |
| `npm test` / Jest locally | NOT RUN — same reason |
| `tsc` / `typecheck:strict` locally | NOT RUN — same reason |
| ESLint locally | NOT RUN — same reason |
| `prisma validate` locally | NOT RUN — same reason |
| `nest build` locally | NOT RUN — same reason |
| GitHub CI — `Build & Unit Tests` | VERIFIED — success on `5f088db` (job 100520807709) |
| GitHub CI — `Lint & Strict Types` | VERIFIED — success on `5f088db` (job 100520807582) |
| GitHub CI — `Dependency Audit` | VERIFIED — success on `5f088db` (job 100520807407) |
| GitHub CI — `Secret Scan` | VERIFIED — success on `5f088db` (job 100520807301) |
| GitHub CI — `Audit Report` | VERIFIED — success on `5f088db` (job 100520807572) |
| Runtime behavior against a real database | NOT VERIFIED — no database was reachable |

CI history on this branch (all failures fixed, nothing hidden):

1. `aef3301` — FAIL: ESLint, unused `normalizeLeaderboardConfig` import.
2. `469946c` — FAIL: `typecheck:strict`, "Spread types may only be created from
   object types" at `leaderboard.service.ts:348` (empty arrays typed as
   `unknown[]`); fixed by an explicit `LeaderboardRowView` type.
3. `5449158` — FAIL: Jest. The first spec compared the normalized config with
   the default seed via `toEqual`, but normalization materializes optional rule
   fields as `null` while the seed omits them.
4. `5f088db` — all five checks green.

## 7. Backward compatibility

The published endpoint, its field names and its Arabic `scoreUnit` value are
unchanged; every new field is additive. Guards, JWT auth, RBAC, service
boundaries, Redis usage, Socket.IO, trip lifecycle, profile levels, incentives
and financial settlement were not modified.

## 8. Unrelated defect — logged only, not fixed

`DriverSelfService.updateTripStatus` (`PATCH /api/driver/me/trips/:id/status`)
completes a trip with a guarded `updateMany` and calls
`profileLevels.onTripCompleted(tripId)`, but never triggers settlement, unlike
`TripsService`. Therefore `settlementStatus` / `settledAt` are not reliable and
were intentionally **not** used as a scoring gate. Out of scope here.

## 9. Remaining risks

- Period windows are computed in UTC; Algeria is UTC+1 with no DST, so a
  weekly/monthly boundary can differ by one hour of local time. Documented
  rather than silently "fixed".
- Past periods are recomputed from current rules. If an admin edits a rule
  mid-week, last week's numbers can shift. Freezing historical periods needs a
  stored snapshot and was not built without a proven business requirement.
- Cached responses are up to `cacheTtlSec` old; this is not a real-time board.
- Query plans were not measured against production volumes; the candidate index
  `Trip(driverId, status, completedAt)` should only be added after `EXPLAIN`.
- Unit tests cover the pure layer. The SQL path has no integration test because
  no database was reachable in this environment.

## 10. Classification of claims

- **VERIFIED**: repository state, schema models/fields used, previous
  leaderboard implementation, settings/cache/profile-level/storage service APIs,
  trip completion paths, CI workflow content and CI results quoted above.
- **INFERENCE**: that the published defaults reproduce today's numbers exactly
  (identical formula and eligibility, unverified against production data); that
  the candidate index would help.
- **NOT VERIFIED**: runtime behavior against a real database, production query
  plans, dashboard UI wiring for the new settings key, and the exact failing
  step of earlier CI runs beyond the annotations quoted above (job logs were not
  accessible).

## 11. Git status

Branch `feature/driver-leaderboard` pushed; PR #24 open against `main` and
**not merged**, as required. Production was never touched.
