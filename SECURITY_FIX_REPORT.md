# Dependency Security Fix — flaminGO Backend

Branch: `fix/dependency-audit-safe` — PR #16 — base `main`

Everything recorded here was executed by GitHub Actions on clean runners.
`npm audit fix --force` was never used. No package was upgraded across a major
version. Prisma, `schema.prisma`, `prisma/migrations/`, and every file under
`src/` are untouched by this task.

## Result

| production audit (`npm audit --omit=dev`) | before | after |
| --- | --- | --- |
| critical | 0 | 0 |
| **high** | **7** | **0** |
| moderate | 21 | 21 |
| low | 0 | 0 |
| total | 28 | 21 |

| verification command | result |
| --- | --- |
| `npm ci --ignore-scripts` | PASS |
| `npm audit --omit=dev --audit-level=high` | PASS |
| `npm run build` | PASS |
| `npm run test:ci` | PASS — 48 suites, 430 passed, 4 skipped |
| `npm run lint:check` | PASS — 0 errors, 23 pre-existing warnings |
| `npm run typecheck:strict` | PASS |

## The seven production HIGH advisories

### 1. `socket.io-parser` 4.2.6 -> >=4.2.7

- GHSA-2m8v-j782-fhvr — Zero-attachment memory exhaustion — affected `>=4.0.0 <4.2.7`
- chain: `ROOT > socket.io@4.8.3 (requires ~4.2.4) > socket.io-parser`
- runtime: yes · same major: yes · parent change: no · override: not needed
- fix: lockfile update inside the parent's existing `~4.2.4` range.
  Socket.IO itself was **not** upgraded.

### 2. `fast-xml-parser` 5.9.3 -> >=5.10.1

- GHSA-8r6m-32jq-jx6q — repeated DOCTYPE declarations reset entity expansion limits (CWE-776) — affected `>=5.9.3 <5.10.1`
- chain: `ROOT > @google-cloud/storage@7.21.0 (requires ^5.3.4) > fast-xml-parser`
- runtime: yes · same major: yes · parent change: no · override: not needed
- fix: lockfile update inside `^5.3.4`.

### 3. `brace-expansion` 1.1.16 and 2.1.2 -> >=1.1.18 and >=2.1.4

- GHSA-mh99-v99m-4gvg — DoS via unbounded expansion length — affected `<1.1.17` and `>=2.0.0 <2.1.3`
- GHSA-rgw5-rvv9-x895 — DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation — affected `<1.1.18` and `>=2.0.0 <2.1.4`
- chains:
  - `minimatch@3.1.5 (requires ^1.1.7) > brace-expansion@1.1.16` (hoisted to the root)
  - `ROOT > exceljs@4.4.0 > archiver@5.3.2 > readdir-glob@1.1.3 > minimatch@5.1.9 (requires ^2.0.1) > brace-expansion@2.1.2`
- runtime: yes · same major: yes · parent change: no
- fix: lockfile update for **both** instances. A single top-level override was
  deliberately avoided: forcing `^2.1.4` everywhere would violate `minimatch@3`'s
  declared `^1.1.7` range.

### 4. `js-yaml` 4.1.0 -> 4.3.1 (override)

- GHSA-5p4m-2wfm-xmqj — quadratic CPU consumption in `!!omap` resolution — affected `>=4.0.0 <4.3.1`
- GHSA-52cp-r559-cp3m — merge-key chains force quadratic CPU — affected `>=4.0.0 <4.3.0`
- GHSA-mh29-5h37-fv8m, GHSA-h67p-54hq-rp68 — moderate, same package
- chain: `ROOT > @nestjs/swagger@7.4.2 > js-yaml` — the parent pins `"4.1.0"` **exactly**
- runtime: yes · same major: yes · parent change: no · **override: yes**
- why the override is safe: 4.3.1 is inside major 4; the `load`/`dump` API has not
  changed since 4.0; this repository's dev tree already ran 4.3.0 through eslint,
  `@eslint/eslintrc` and `cosmiconfig`; and Swagger uses js-yaml only to emit the
  OpenAPI document, not on the request path.
- npm reported `fixAvailable: @nestjs/swagger@11.4.7`, which is a **semver major**.
  It was rejected. Swagger stays on 7.4.2.

### 5. `multer` 2.0.2 -> 2.2.0 (override)

- GHSA-72gw-mp4g-v24j — DoS via deeply nested field names — affected `>=1.0.0 <2.2.0`
- GHSA-3p4h-7m6x-2hcm — incomplete cleanup of aborted uploads — affected `>=2.0.0-alpha.1 <2.2.0`
- GHSA-5528-5vmv-3xc2 (`<2.1.1`), GHSA-xf7r-hgr6-v32p (`<2.1.0`), GHSA-v52c-386h-88mc (`<2.1.0`)
- chain: `ROOT > @nestjs/platform-express@10.4.22 > multer` — the parent pins `"2.0.2"` **exactly**
- runtime: yes · same major: yes · parent change: no · **override: yes**
- why the override is safe: the patched release 2.2.0 is inside major 2, so
  NestJS 11 is not required. The override was verified with a clean install plus
  the full build, the 48 test suites, lint and strict typecheck.
- **operational note:** multer is the real file-upload middleware on the request
  path (driver documents, vehicle photos, profile photos). 2.1/2.2 tightened the
  parsing limits. The repository has no upload integration test, so upload
  behaviour was **not** exercised end to end — only compiled and unit-tested.
  A manual document upload should be checked after deploy.

### 6. `lodash` 4.17.21 -> 4.18.0 (override)

- GHSA-r5fr-rjxr-66jc — code injection via `_.template` imports key names (CWE-94) — affected `>=4.0.0 <=4.17.23`
- GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg — moderate prototype pollution in `_.unset` / `_.omit`
- chains: `ROOT > @nestjs/config@3.3.0 > lodash` and `ROOT > @nestjs/swagger@7.4.2 > lodash` — both pin `"4.17.21"` **exactly**
- runtime: yes · same major: yes · parent change: no · **override: yes**
- registry check: `4.17.24` does **not** exist. The resolver queried the registry
  and selected 4.18.0, the lowest published stable release in major 4 that is
  outside the vulnerable range. This is a minor bump, not a major upgrade.

### 7. `@nestjs/platform-express` 10.4.22 — resolved indirectly, not upgraded

- npm flagged the package itself as HIGH because of its `via` set:
  `multer`, `body-parser`, `express`, `@nestjs/core`. `multer` was the only HIGH
  member.
- `fixAvailable` was `@nestjs/platform-express@11.2.1`, a **semver major**, and
  was rejected.
- fixing `multer` under it dropped the package out of the HIGH set. It remains on
  10.4.22 and NestJS stays on 10.

## Dev / build-only HIGH advisories — intentionally out of scope

`@nestjs/cli`, `glob@10.4.5`, `picomatch@4.0.x` and `tmp` are HIGH in the full
tree but absent from `npm audit --omit=dev`. Every one of them listed
`@nestjs/cli@11.0.24` (a major upgrade) as the only fix. They are build tooling
and are never shipped, so the blocking gate is scoped with `--omit=dev`. They are
still reported by a separate non-blocking step, so nothing is hidden.

Measured evidence: 11 HIGH in the full tree vs 7 in production, and 496 of the
1025 packages in the lockfile are reachable from `dependencies`.

## Remaining advisories, and why they stay

21 **moderate** advisories remain in production. None is HIGH or CRITICAL, so the
gate at `--audit-level=high` passes honestly rather than by suppression. They
share two roots:

1. **The `exceljs@4.4.0` legacy chain** — `glob@7.2.3`, `tmp@0.2.7`,
   `rimraf@2.7.1` via `archiver@5.3.2` and `unzipper@0.10.14`. Note that the HIGH
   `glob` advisory covers `10.2.0 - 10.4.5` and the HIGH `tmp` advisory covers
   `<=0.2.5`; the runtime copies here are `glob@7.2.3` and `tmp@0.2.7`, which fall
   **outside** both HIGH ranges. So the runtime exposure through exceljs is
   moderate, not high. Moving `archiver-utils@2.1.0` from glob 7 to glob 9/10 is an
   interface change, so `exceljs` was **not** replaced or upgraded on suspicion.
2. **The `uuid` / `retry-request` / `teeny-request` chain** under
   `firebase-admin`, `@google-cloud/storage` and `google-gax` — upstream
   responsibility, moderate only.

Both deserve a separate, independently tested task.

## Changed files

| file | change |
| --- | --- |
| `package.json` | added an `overrides` block with three entries |
| `package-lock.json` | regenerated by npm inside Actions (65 insertions, 96 deletions) |
| `.github/workflows/security.yml` | blocking gate scoped to `--omit=dev`; `continue-on-error` removed |
| `.github/workflows/dependency-audit-report.yml` | new, read-only audit reporter |
| `.github/workflows/security-fix-apply.yml` | the fix pipeline, later reduced to manual re-verification |
| `.github/scripts/*.js`, `.github/security-fix-plan.json` | the resolver, the override writer, the reporter and the documented plan |
| `SECURITY_FIX_REPORT.md` | this file |

Nothing under `prisma/`, `src/`, `test/` or `scripts/` was modified. The fix
pipeline enforced this itself: it aborts if any file other than `package.json`
and `package-lock.json` changes during the fix stage.

## The overrides, verbatim

```json
"overrides": {
  "js-yaml": "4.3.1",
  "multer": "2.2.0",
  "lodash": "4.18.0"
}
```

Each version was proved to exist by querying the npm registry inside Actions
before it was written; the resolver refuses to emit an override for an
unpublished version.

## Major upgrades performed

None. NestJS stays on 10.4.22, `@nestjs/swagger` on 7.4.2, `socket.io` on 4.8.x,
`@nestjs/cli` on 10.4.9, and PR #12 (the NestJS 11 group) was neither merged nor
relied upon.
