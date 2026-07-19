# SERIAL_CONTEXT_001

## Title
EIP Core V2 high-level continuity and architectural intent

## Purpose
This file captures the minimum continuity needed to keep V2 aligned with the kernel-first foundation.

## Core identity
- EIP Core V2 is a kernel-first ERP/platform foundation.
- The system must remain multi-tenant.
- The system must remain engine-based rather than feature-hardcoded.
- Flexibility and extensibility are primary design goals.

## Architectural direction
- Shared behavior should be expressed through reusable kernel and engine patterns.
- Prefer process/task/UI engine approaches over one-off page logic.
- Prefer metadata-, schema-, and configuration-driven behavior where appropriate.
- Do not hardcode tenant-specific business logic into shared kernel code.
- Keep the 5-layer process canon explicit: process, task label, macro, effect library, service object + service object category runtime parameters.

## Service object canon
- Service object is the kernel concept of EIP Core.
- It must be described at two levels at once: conceptual kernel unit and operational case instance.
- Business classes include agent/entity, asset, material, document, and money.
- Those classes may support, execute, constrain, or record a process.
- When any of them becomes the active subject of a workflow, it is represented as a service object.
- Supporting classes do not replace the kernel center of the process.

## Data direction
- Core governed structures should remain relational.
- Flexible, extensible, object-specific, or tenant-specific payloads may use JSONB under governance.
- JSONB must not be used as a shortcut to avoid governing core data.

## Multi-tenant rule
- Shared code must remain tenant-agnostic.
- Tenant-specific behavior should be isolated through controlled extension points, metadata, configuration, assets, or tenant-level frontend logic.

## Implementation rule
- If a fast shortcut conflicts with architecture, preserve architecture.
- Reuse existing kernel and engine patterns before introducing narrow custom logic.
- Prefer minimal production-safe changes.

## Worker instruction
Before architecture-sensitive work, read:
1. `AGENTS.md`
2. `AGENT_TASKS.md`
3. `docs/codex/ARCHITECTURE_GUARDRAILS.md`
4. this file
