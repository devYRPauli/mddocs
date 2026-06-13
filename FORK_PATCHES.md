# Fork Patches

Local modifications to vendored `@proof/*` (proof-sdk) source. Keep this list small;
each entry should be a candidate to upstream so we can eventually drop it.

## 1. `packages/doc-core/src/index.ts` — fix TS2308 duplicate exports

**Commit:** `8742f29`
**Why:** The barrel did `export *` from both `src/formats/marks.ts` and
`src/formats/provenance-sidecar.ts`, which both export `createComment`,
`getUnresolvedComments`, and `CommentReply`. TypeScript ≥5 rejects this (TS2308),
so `@proof/core` cannot be imported at all under modern TS.
**Fix:** Replaced the `export *` from `provenance-sidecar` with explicit named
re-exports of its 21 non-colliding symbols (marks.ts wins for the 3 colliders).
No downstream consumer imported the dropped names via `@proof/core`.
**Upstream status:** SUBMITTED — [EveryInc/proof-sdk#57](https://github.com/EveryInc/proof-sdk/pull/57). Drop this patch if merged.

## 2. `scripts/finalize-web-build.mjs` — fix `npm run build` under paths with spaces

**Why:** the script derived the repo root from `new URL(import.meta.url).pathname`,
which leaves URL encoding intact (e.g. a space becomes `%20`). On a clone whose
path contains a space, the finalize step then failed with `ENOENT` opening
`…/Open-Source%20Projects/…/package.json`, so `npm run build` crashed after Vite.
**Fix:** derive the root with `fileURLToPath(import.meta.url)`, which decodes the
file URL. Correct on all platforms; only observable when the path has spaces.
**Upstream status:** candidate to upstream.
