# ADR-013: Better Auth utility dependency alignment

## Context

Better Auth 1.7.5 and its first-party plugins depend on `better-call@1.4.0`. The published dependency graph can resolve two copies of `@better-auth/core` because Better Auth currently declares `@better-auth/utils@0.4.2` while `better-call@1.4.0` requires `@better-auth/utils@0.5.0`.

With pnpm this produces structurally distinct Better Auth plugin types and makes first-party plugins fail TypeScript compatibility checks even though they are from the same Better Auth release family.

## Decision

Pin the first-party Better Auth packages exactly at the tested release and use a root pnpm override:

```json
{
  "pnpm": {
    "overrides": {
      "@better-auth/utils": "0.5.0"
    }
  }
}
```

Do not use casts, `any`, or `skipLibCheck` to hide the split type graph.

## Consequences

The workspace has one Better Auth utility/core type identity. CI typecheck is the compatibility gate.

## Security impact

The override changes dependency resolution only. It does not weaken authentication or authorization checks. Auth packages remain exact-pinned and must be updated deliberately.

## Migration/reversal

Remove this override when a tested upstream Better Auth release no longer resolves duplicate utility/core graphs. The removal must pass install, typecheck, auth contract tests and production smoke tests.
