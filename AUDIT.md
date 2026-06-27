# Security audit — hardened fork of Remarkable Synchronizer

Fork of [`dsebastien/obsidian-remarkable-sync`](https://github.com/dsebastien/obsidian-remarkable-sync)
(MIT). Forked at upstream `d50eb02` (`chore(release): 1.4.3`).

**Why this fork exists:** the upstream community plugin auto-updates an opaque
minified bundle and holds reMarkable cloud credentials. A poisoned upstream update
is the threat model. This fork **pins + audits the dependency tree, builds the
bundle from source we have read, and disables store auto-update** (manifest version
set deliberately high). Supply-chain safety is the prime directive.

## Toolchain (faithful, reproducible build)

> **Deviation from the original directive:** the directive assumed `npm ci` + an
> esbuild config. Upstream has since migrated to **Bun** — the only committed
> lockfile is `bun.lock` (no `package-lock.json`), the bundler is `Bun.build`
> (`scripts/build.ts`), and `packageManager` pins `bun@1.3.14`. Using `npm install`
> would resolve a **fresh** dependency tree, defeating "install strictly from the
> committed lockfile." The faithful + most-secure path is therefore Bun with a
> frozen lockfile.

- **bun** `1.3.14` (pinned via `packageManager`; installed globally as `npm i -g bun@1.3.14`).
- Install: `bun install --frozen-lockfile` (reproduces the committed `bun.lock` exactly).
- Build: `bun run build` = `tsc --noEmit` then `bun scripts/build.ts --prod`
  (`Bun.build`, `format: cjs`, `target: node`, `minify: true`). We ship **our own**
  `main.js`, never upstream's prebuilt artifact (build artifacts are git-ignored:
  `main.js`, `styles.css`, `dist/`).
- node `v26.4.0` on the build host (repo `engines` requires node >= 20).

## Runtime (shipped) dependencies — pinned exact versions

These are the only packages bundled into `main.js`:

| Package            | Version | Notes                         |
| ------------------ | ------- | ----------------------------- |
| `@leeoniya/ufuzzy` | 1.0.19  | fuzzy match (notebook picker) |
| `date-fns`         | 4.1.0   | date formatting               |
| `immer`            | 11.0.1  | immutable state updates       |
| `jszip`            | 3.10.1  | `.rmdoc`/zip handling         |
| `zod`              | 4.1.13  | schema validation             |

`jszip` transitive runtime closure (also bundled): `lie@3.3.0`, `pako@1.0.11`,
`setimmediate@1.0.5`, `immediate@3.0.6`. The `setimmediate` polyfill's old-IE branch
(which does `document.createElement`) is **replaced at build time** by a DOM-free
`Promise`-based shim (`stripSetImmediatePolyfillPlugin` in `scripts/build.ts`) — no
dynamic `<script>` creation reaches the shipped bundle.

`obsidian`, `electron`, and all `@codemirror/*` / `@lezer/*` packages are marked
**external** in the build — provided by the Obsidian runtime, not bundled.

Dev/tooling dependencies (eslint, typescript, tailwind, commitlint, prettier, etc.)
are pinned in `package.json` + `bun.lock` and are **not** shipped in the bundle.

## `bun audit` findings

```
1 vulnerabilities (1 moderate)
js-yaml  <=4.1.1  (GHSA-h67p-54hq-rp68: quadratic-complexity DoS in merge keys)
  via: eslint › @eslint/eslintrc › js-yaml
       @commitlint/cli › … › cosmiconfig › js-yaml
       commitizen › … › cosmiconfig › js-yaml
```

- **Disposition: accepted, no runtime exposure.** `js-yaml` is reached only through
  **dev tooling** (eslint / commitlint / commitizen) and is never bundled into
  `main.js`. The DoS requires feeding adversarial YAML to those tools; we only run
  them on our own repo. Not `--fix`'d to avoid an unreviewed transitive bump
  (directive: review, do not blind-fix).

## Dependency-tree change made in this fork (dev-only)

- **Removed the global `ajv: 8.20.0` override** from `package.json`.
    - _Why:_ upstream's override forced ajv 8 onto every consumer, but
      `@eslint/eslintrc` requires ajv 6 (`ajv._opts.defaultMeta = metaSchema.id` →
      `TypeError`), which **crashed `bun run lint` on a clean upstream checkout**
      (verified by stashing all fork changes — pre-existing upstream breakage).
    - _Effect:_ `ajv` now resolves to **6.15.0** (patched 6.x; the known ReDoS
      CVE-2020-15366 was fixed in 6.12.3) for eslintrc, while consumers that need
      ajv 8 (`@commitlint/config-validator`, `eslint-plugin-json-schema-validator`,
      `json-schema-migrate`) keep `8.20.0` nested. Lockfile churn was **scoped to ajv
      only** (no other package moved). `bun audit` reports no ajv advisory before or
      after. Dev-only; the shipped bundle is unaffected.

## Blocked install scripts (supply-chain posture)

`bun pm untrusted` reports one blocked lifecycle script, left **untrusted**
(not run):

- `@parcel/watcher@2.5.1` → `node scripts/build-from-source.js` (a dev transitive).
  Not needed for our build (`Bun.build` does not use it). Left blocked.

## Network surface (runtime)

Every runtime network call goes through Obsidian's `requestUrl` (no raw `fetch`,
`XMLHttpRequest`, `axios`, etc. in shipped code). Enumerated destinations:

| Host                                               | Where                                                         | Purpose                                                |
| -------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| `https://webapp-prod.cloud.remarkable.engineering` | `src/app/services/cloud/cloud-urls.ts` (`OFFICIAL_AUTH_BASE`) | device/user token auth                                 |
| `https://internal.cloud.remarkable.com`            | `src/app/services/cloud/cloud-urls.ts` (`OFFICIAL_SYNC_BASE`) | notebook sync/download                                 |
| `https://my.remarkable.com/device/desktop/connect` | `src/app/ui/auth-modal.ts`                                    | one-time-code connect link shown to user               |
| _user-configured rmfakecloud base URL_             | `cloud-urls.ts` (`resolveCloudUrls`)                          | self-hosted rmfakecloud (opt-in; validated http/https) |

**All official destinations are reMarkable-owned.** No analytics/telemetry SDKs
(no sentry/posthog/mixpanel/etc.). The reMarkable token is read/written via the
token store; it is **not logged or transmitted anywhere except the reMarkable
hosts above**.

### Funding / social nags — stripped

| Item                                                                         | Before                        | After   |
| ---------------------------------------------------------------------------- | ----------------------------- | ------- |
| `manifest.json` `fundingUrl`                                                 | `buymeacoffee.com/dsebastien` | removed |
| "Follow me on X" button → `window.open('https://x.com/dSebastien')`          | present                       | removed |
| Buy-me-a-coffee badge (`<a href=buymeacoffee.com>` + 24KB embedded data-URL) | present                       | removed |
| `src/assets/buy-me-a-coffee.png`, `src/app/assets/buy-me-a-coffee.ts`        | shipped                       | deleted |

The About settings section now shows only a static credit to the upstream author
(MIT attribution preserved) + a "no telemetry / reMarkable-only" disclosure. These
were **inert UI links** (fired only on user click / settings render) — not active
beacons — but removed per directive. Removing the embedded badge data-URL shrank the
bundle ~33KB (241KB → 208KB).

## Anti-auto-replace

- Plugin `id` kept as `remarkable-synchronizer` (preserves the user's existing
  `data.json` `syncStore`/settings).
- `manifest.json` / `package.json` `version` set to **`9.0.0`** — deliberately far
  above upstream's `1.4.x` line so Obsidian's community store can never offer a
  silent "update" that replaces this self-built bundle with upstream's prebuilt one.
  `versions.json` maps `9.0.0` → minAppVersion `1.7.2`.

## Gate ladder (this build)

`bun install --frozen-lockfile` ✓ · `bun audit` (reviewed) ✓ · `bun run tsc` ✓ ·
`bun run lint` (`--max-warnings 0`) ✓ · `bun test` (136 pass / 0 fail) ✓ ·
`bun run build` ✓.
