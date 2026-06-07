# ADR: Proof SDK Public Core

## Status

Accepted

## Decision

We are separating the hosted `Proof` product from a reusable `Proof SDK` core.

Inside this repo, the shared extraction boundary now lives under `packages/`:

- `@proof/core`
- `@proof/editor`
- `@proof/server`
- `@proof/sqlite`
- `@proof/agent-bridge`

The hosted product keeps:

- hosted product auth and session flows
- hosted product branding and growth work
- product-specific agent UX and orchestration layers

The shared core keeps:

- document and provenance model
- editor-facing collaboration code
- generic document/share/collab server routes
- agent bridge protocol and typed client

## Consequences

- Shared changes should start at the package boundary, even before the public repo extraction happens.
- Hosted Proof stays the user-facing product name.
- Public extraction target is `proof-sdk`, with `Proof SDK` as the project name and `Proof` reserved for the hosted service.
