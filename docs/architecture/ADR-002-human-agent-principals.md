# ADR-002: Human and agent principals

## Context
An AI employee must not impersonate a human or inherit broad user credentials.

## Decision
HUMAN, AGENT and SYSTEM are distinct principal types with workspace binding and explicit capabilities. Agents cannot self-approve, manage users, manage connections, or manage credentials.

## Consequences
The runtime prompt is not a security boundary; authorization is enforced after principal resolution.
