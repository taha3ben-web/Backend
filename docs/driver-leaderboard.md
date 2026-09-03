# Driver Leaderboard Engine (Dashboard-Controlled)

Status: implemented on branch `feature/driver-leaderboard` (PR #24). No Prisma
schema change, no migration.

## 1. What the driver sees

`GET /api/driver/me/leaderboard/summary?period=WEEKLY|MONTHLY|ALL_TIME&scope=NATIONAL|WILAYA&limit=N`

- National rank + score, and rank + score inside the driver's own wilaya.
- Top drivers nationally and inside the wilaya.
- `pointsToNext` (gap to the driver directly ahead) and `pointsToLeader`.
- The active period window (`from`, `to`, `computedAt`, `cachedTtlSec`).
- The scoring rule keys that actually produced the score (`appliedRuleKeys`).
- Profile level, reported as a **separate** system (`system: "PROFILE_LEVELS"`).

The legacy endpoint `GET /api/driver/me/leaderboard` is preserved and still
returns `{ scope, localBasis, period, available, total, rows, me }` with the
same field names and the same Arabic `scoreUnit` string, plus additive fields.
Existing Driver App builds keep working unchanged.

## 2. Where the score comes from

The score is **always derived server-side** from database facts:

| Rule type | Source of truth |
| --- | --- |
| `COMPLETED_TRIP` | `Trip.status = COMPLETED` (+ `completedAt` for the period window) |
| `PEAK_HOUR_TRIP` | hour of `Trip.completedAt` (supports a window crossing midnight) |
| `RATING_BONUS` | `Driver.rating` compared against a configured threshold |
| `CANCELLATION_PENALTY` | `Trip.status = CANCELLED` **and** `Trip.cancelledBy = DRIVER` |
| `CAMPAIGN_MULTIPLIER` | time-boxed multiplier applied to the subtotal |

No client-provided statistics are ever trusted, and money/earnings are **not**
an input. Acceptance rate and streaks are deliberately **not supported**: the
database does not store per-driver rejected dispatch offers reliably, so any
such number would be unprovable.

Formula (identical in TypeScript and in SQL):

```
score = max(0, round(
  (completedTrips * perTrip
   + peakTrips * perPeakTrip
   + (rating >= threshold ? ratingBonus : 0)
   - driverCancellations * penalty) * campaignMultiplier))
```

## 3. Dashboard configuration (no code deploy for business changes)

All rules live in the existing `Setting` model under one key:

- key: `driver.leaderboard`
- group: `driver`

Per rule: `key, type, enabled, value, threshold, startHour, endHour, startAt,
endAt, scope (ALL|WILAYA), wilayaId, priority`.
Global: `enabled, period, topLimit, weekStartsOn, cacheTtlSec, eligibility`.

Writes are **not** exposed by the leaderboard admin controller on purpose. The
only write path is the existing governed settings flow, which already provides
draft -> review -> publish, revisions and `AuditLog` (who changed what, when):

1. `POST /api/settings` with `{ key: "driver.leaderboard", value: {...}, group: "driver" }`
2. `POST /api/settings/driver.leaderboard/request-review`
3. `POST /api/settings/change-requests/:id/approve`

Read-only admin helpers (require `STAFF` + `settings.manage`):

- `GET /api/drivers/leaderboard/config` — effective config, limits, warnings.
- `GET /api/drivers/leaderboard/preview` — score preview for sample metrics.

Invalid or hostile config never takes the screen down: values are clamped to
`LEADERBOARD_LIMITS`, unsupported/duplicate rules are dropped, and every
correction is returned as a `warnings[]` entry for the admin.

### Defaults reproduce today's published behavior exactly

`COMPLETED_TRIP = 1` enabled; rating bonus, peak-hour bonus, cancellation
penalty and campaign multiplier shipped **disabled**. On deploy, no driver's
number changes.

## 4. Eligibility

From the configured `eligibility` block, defaulting to the currently published
behavior: `Driver.status = APPROVED`, active `User.status`, active temporary
suspension excluded (`Driver.suspendedUntil`), plus optional
`minCompletedTrips` / `minRating` thresholds (both `0` by default).

## 5. Wilaya scope

The wilaya is taken **only** from the authenticated driver (`Driver.wilayaId`).
A `wilayaId` sent by the client is ignored. If the driver has no wilaya, the
response returns `{ available: false, reason: "WILAYA_UNAVAILABLE" }` instead of
fabricating a local ranking.

## 6. Ranking and determinism

Order: `score DESC -> rating DESC -> completedTrips DESC -> driverId ASC`.
Because `driverId` is unique the order is **total**, so ranks are **ordinal**
(1, 2, 3, 4) and duplicate positions cannot occur — neither competition nor
dense ranking is needed. The same data always yields the same ranks.

## 7. Performance

Ranking runs in PostgreSQL with window functions (`ROW_NUMBER`, `COUNT(*) OVER`,
`MAX(...) OVER`, `LAG`, `PARTITION BY wilaya_id`) over a CTE chain
(`eligible -> metrics -> scored -> ranked`). Exactly **two** parameterized raw
queries per request: one for the driver's own position, one for the top rows.
No `findMany` over all drivers, no `take: 1000`, no sorting in Node.js, and the
rank outside the top N is still exact.

Optional future index (only if production `EXPLAIN` proves the need, in its own
migration): `Trip(driverId, status, completedAt)`.

## 8. Caching — explicitly not real-time

Results are cached through the existing `ConfigCacheService` under namespace
`driver-leaderboard`, keyed by driver, period, scope, limit, wilaya and config
version, with TTL `cacheTtlSec` (default 60s, max 300s). PostgreSQL remains the
source of truth. The response carries `computedAt` and `cachedTtlSec` so the
app can display freshness. **This is not a real-time leaderboard.**

## 9. Security and anti-gaming

- JWT auth, existing guards, no change to authorization boundaries.
- Score inputs are server-derived only; the client cannot submit points.
- Top rows expose only `rank, driverId, name, photoUrl, cityName, wilayaName,
  score, scoreUnitKey, rating, completedTrips, isMe`. No phone, email, address,
  KYC, IBAN, financial or location data.
- Idempotency is structural: the score is a re-derived aggregate, never an
  incremented balance, so duplicate events, retries and replays cannot inflate
  it. Cancelled/rejected trips can only subtract, and only when the driver
  cancelled.
- Config cannot inject SQL: rules are converted into validated numeric
  coefficients before the query is built.

## 10. i18n

No user-facing wording is hard-coded for new fields: the score unit is returned
as `scoreUnitKey: "TRIP" | "POINT"` for the app to translate (ar/fr/en, RTL).
The legacy Arabic `scoreUnit` string is kept for backward compatibility only
and is deprecated.
