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
**Upstream status:** TO SUBMIT as a PR to EveryInc/proof-sdk. Drop this patch if merged.
