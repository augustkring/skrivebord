# ADR-001: Shared Action Layer

## Context
Humans, agents, jobs and webhooks can all cause business mutations. Separate privileged paths would create inconsistent authorization and audit behavior.

## Decision
Every consequential business mutation must execute through the same typed Action Layer. MCP and OpenClaw are callers, not bypasses.

## Consequences
All actions require typed input, workspace binding, capability policy, risk evaluation, intent persistence and audit.

## Security impact
This is the primary application-level authorization boundary.

## Migration/reversal
A future policy engine may replace the evaluator behind the same Action Layer contract.
