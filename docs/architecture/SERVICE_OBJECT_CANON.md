# SERVICE_OBJECT_CANON

This document defines the service object canon for EIP Core V2.

## Definition
- Service object is the canonical kernel concept for managed work.
- It is also the operational case instance that a process acts upon.
- The two are not separate inventions; they are the same concept at different abstraction levels.

## Two levels
- Conceptual level: the durable kernel idea that names the managed subject of work.
- Operational level: the concrete case instance that enters a process, carries state, and receives effects.
- System behavior should preserve this dual view rather than collapsing it into a single narrow record type.

## Eligible business classes
- Agent/entity
- Asset
- Material
- Document
- Money

Any of these can become a service object when the process acts on it as the active case.

## Canonical usage
- Service objects are acted on by the process engine.
- Service objects may emit tasks, effects, validations, or state transitions.
- Service objects are governed by metadata, not by tenant-specific hardcoded branches.
- Supporting classes remain supporting classes unless and until they become the active case.

## Boundary
- Do not treat service object as a UI-only label, a workflow-only record, or a tenant-specific shortcut.
- Do not split the canon into separate "concept" and "instance" vocabularies unless the abstraction is explicitly required.