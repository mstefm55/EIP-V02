# KERNEL_CANON

This document captures the kernel-level canon for EIP Core V2.

## Canon
- EIP Core V2 is kernel-first, engine-based, multi-tenant, and metadata-driven.
- The kernel is the durable shared model; features must fit the kernel before they become implementation details.
- Reuse is preferred over specialization.

## Managed work
- Service object is the kernel unit of managed work.
- A service object can be understood as both the conceptual kernel unit and the operational case instance.
- Those are the same concept at different abstraction levels.
- The kernel should not introduce separate concepts when one service object concept is sufficient.

## Business classes
- Business classes include agent/entity, asset, material, document, and money.
- These classes may support, execute, constrain, or record a process.
- Any of these classes may become a service object when it becomes the active case.

## Control principles
- Shared code stays tenant-agnostic.
- Tenant variation belongs in metadata, configuration, approved extension points, or governed tenant assets.
- Core governed structures stay relational.
- JSONB is reserved for flexible payloads that still remain under governance.

## Change test
Before introducing a new abstraction, ask whether the kernel, an engine, metadata, or existing governed schema can already represent it.
