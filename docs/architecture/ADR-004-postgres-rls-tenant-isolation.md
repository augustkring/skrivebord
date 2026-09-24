# ADR-004: PostgreSQL RLS tenant isolation

## Context
Authentication does not prove authorization to a workspace object. Skrivebord requires both application object authorization and database defense in depth.

## Decision
Every tenant-owned query is bound to a resolved workspace. Server transactions set trusted request-local PostgreSQL context and RLS checks `app.workspace_id`. Application roles must not receive `BYPASSRLS`.

## Consequences
Cross-workspace access must fail even when an object ID is guessed. The Principal Resolver, Query Service and Action Layer remain the primary authorization boundaries; RLS is a second line of defense.

## Security impact
Reduces blast radius from missed query filters and IDOR-style mistakes. Audit data is append-only through normal application paths.

## Migration/reversal
Policies can be extended per table without changing public Action Layer contracts.
