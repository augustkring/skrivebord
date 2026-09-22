# Skrivebord

Skrivebord is a shared operational workspace where a person and an AI employee work from the same business context, actions, approvals and history.

## Current build

This branch implements the first runnable vertical slice of the master brief:

- pnpm/Next.js/TypeScript monorepo baseline
- typed principals, capabilities and action contracts
- deterministic rental rules and Today engine
- approval-aware Action Layer core
- Drizzle/PostgreSQL schema foundation
- core product shell: I dag, Kalender, År, Opmærksomhed, Aktivitet and Indstillinger
- persistent contextual Mojn panel UI
- health endpoints and CI

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm typecheck
pnpm build
```
